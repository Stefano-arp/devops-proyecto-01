#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

# stdin: Docker Hub username, PAT, immutable 40-character commit SHA (one line each).
IFS= read -r docker_user
IFS= read -r docker_token
IFS= read -r image_sha
[[ "$docker_user" =~ ^[a-z0-9_][a-z0-9_.-]*$ && "$image_sha" =~ ^[a-f0-9]{40}$ && -n "$docker_token" ]] || {
    echo 'Invalid deployment input' >&2
    exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_dir/devops-practica.conf" ]]; then
    source_dir="$script_dir"  # files staged together by CI
else
    source_dir="$script_dir/../nginx"  # local invocation from scripts/
fi
for file in devops-practica.conf blue.conf green.conf; do
    [[ -f "$source_dir/$file" ]] || { echo "Missing nginx/$file" >&2; exit 1; }
done

root=/opt/devops-practica
nginx_dir="$root/nginx"
data_dir="$root/data"
site_conf=/etc/nginx/conf.d/devops-practica.conf
active_link="$nginx_dir/active.conf"
image="$docker_user/devops-practica:$image_sha"
previous=''
new_container=''
new_started=0
new_attempted=0
switched=0
installed_config=0
staging_link="$nginx_dir/.active-$$-$RANDOM.conf"
docker_config=''

swap_link() {
    # ln creates a complete symlink, mv -T atomically replaces the live one.
    sudo -n ln -s -- "$1" "$staging_link"
    sudo -n mv -Tf -- "$staging_link" "$active_link"
}

cleanup() {
    local status=$?
    local rollback_ok=1
    trap - EXIT
    set +e
    if (( status != 0 )); then
        if (( switched )) && [[ -n "$previous" ]]; then
            echo 'Deployment failed: restoring the previous nginx upstream' >&2
            sudo -n rm -f -- "$staging_link"
            swap_link "$previous" && sudo -n nginx -t >/dev/null 2>&1 && sudo -n systemctl reload nginx
            rollback_ok=$?
        elif [[ -z "$previous" ]] && (( installed_config )); then
            # First installation has no old upstream; restore the nginx setup
            # that was present before this deployment (do not touch other sites).
            sudo -n rm -f -- "$site_conf" "$active_link"
            sudo -n nginx -t >/dev/null 2>&1 && sudo -n systemctl reload nginx
            rollback_ok=$?
        fi
        if (( rollback_ok != 0 )); then
            echo 'Nginx rollback failed; leaving candidate container running for recovery' >&2
        elif (( new_started )); then
            docker rm -f -- "$new_container" >/dev/null
        elif (( new_attempted )) && docker container inspect "$new_container" >/dev/null 2>&1; then
            # docker run may create a container but fail to start it (e.g. a
            # port conflict). Only the container created by this run is ours.
            if [[ "$(docker inspect -f '{{ index .Config.Labels "devops.commit" }}' "$new_container")" == "$image_sha" ]]; then
                docker rm -f -- "$new_container" >/dev/null
            fi
        fi
    fi
    sudo -n rm -f -- "$staging_link" >/dev/null 2>&1
    if [[ -n "$docker_config" ]]; then
        rm -rf -- "$docker_config"
    fi
    # Only clean up our own CI staging files; never delete data or backups.
    if [[ "$script_dir" == /tmp/devops-practica-deploy-* ]]; then
        rm -f -- "$script_dir/deploy.sh" "$script_dir/devops-practica.conf" "$script_dir/blue.conf" "$script_dir/green.conf"
        rmdir -- "$script_dir" 2>/dev/null
    fi
    exit "$status"
}
trap cleanup EXIT

command -v docker >/dev/null
command -v curl >/dev/null
sudo -n nginx -v >/dev/null 2>&1
sudo -n systemctl is-active --quiet nginx || {
    echo 'nginx must be installed and running on the host (and its default port-80 site disabled)' >&2
    exit 1
}
# Host Docker is also required; user must have Docker access and passwordless
# sudo for nginx configuration, nginx -t and systemctl reload nginx.
docker info >/dev/null
sudo -n install -d -m 755 -- "$root" "$nginx_dir"
if [[ ! -d "$data_dir" ]]; then
    sudo -n install -d -o 1000 -g 1000 -m 750 -- "$data_dir"
fi

if [[ -L "$active_link" ]]; then
    previous="$(readlink -- "$active_link")"
    case "$previous" in
        "$nginx_dir/blue.conf") new_slot=green; new_port=3002 ;;
        "$nginx_dir/green.conf") new_slot=blue; new_port=3001 ;;
        *) echo 'Unknown active nginx target; refusing to change it' >&2; exit 1 ;;
    esac
    [[ -f "$site_conf" ]] || { echo 'Missing managed nginx site; refusing to deploy' >&2; exit 1; }
    cmp -s -- "$source_dir/devops-practica.conf" "$site_conf" || {
        echo 'Existing nginx site differs from repository; migrate it manually' >&2
        exit 1
    }
else
    [[ ! -e "$active_link" && ! -e "$site_conf" && ! -L "$site_conf" ]] || {
        echo 'Partial/unmanaged nginx configuration; resolve manually' >&2
        exit 1
    }
    new_slot=blue
    new_port=3001
fi
new_container="devops-practica-$new_slot"
for slot in blue green; do
    if [[ -e "$nginx_dir/$slot.conf" || -L "$nginx_dir/$slot.conf" ]]; then
        cmp -s -- "$source_dir/$slot.conf" "$nginx_dir/$slot.conf" || {
            echo "Existing $slot upstream differs; resolve manually" >&2
            exit 1
        }
    else
        sudo -n install -m 644 -- "$source_dir/$slot.conf" "$nginx_dir/$slot.conf"
    fi
done

# Never store a PAT in command arguments, the image, or a persistent Docker config.
docker_config="$(mktemp -d)"
export DOCKER_CONFIG="$docker_config"
printf '%s' "$docker_token" | docker login --username "$docker_user" --password-stdin >/dev/null
unset docker_token
docker pull "$image" >/dev/null

# Fail early on existing database permissions rather than silently creating a
# different DB inside the image or serving an unwritable SQLite file.
docker run --rm --mount "type=bind,src=$data_dir,dst=/app/data" "$image" node -e \
    "const fs=require('fs');fs.accessSync('/app/data',fs.constants.W_OK);const db='/app/data/database.sqlite';if(fs.existsSync(db))fs.accessSync(db,fs.constants.W_OK)" >/dev/null

if docker container inspect "$new_container" >/dev/null 2>&1; then
    [[ "$(docker inspect -f '{{ index .Config.Labels "app" }}' "$new_container")" == devops-practica ]] || {
        echo 'Inactive container name belongs to an unmanaged container; refusing to remove it' >&2
        exit 1
    }
    docker rm -f -- "$new_container" >/dev/null
fi
# Blue and green share ONE persistent host directory. Both publish only to
# loopback; only host nginx exposes port 80. Stop the old slot after switching.
new_attempted=1
docker run -d --name "$new_container" --label app=devops-practica --label "devops.commit=$image_sha" \
    --env "APP_VERSION=$image_sha" --restart unless-stopped --publish "127.0.0.1:$new_port:3000" \
    --mount "type=bind,src=$data_dir,dst=/app/data" "$image" >/dev/null
new_started=1

healthy=0
for (( attempt=0; attempt<30; attempt++ )); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$new_port/api/health" 2>/dev/null | grep -Fq "\"version\":\"$image_sha\""; then
        healthy=1
        break
    fi
    [[ "$(docker inspect -f '{{.State.Running}}' "$new_container")" == true ]] || break
    sleep 2
done
(( healthy )) || { echo 'Candidate unhealthy before traffic switch; previous slot retained' >&2; exit 1; }

if [[ -z "$previous" ]]; then
    installed_config=1  # clean up even if install writes a partial new file
    sudo -n install -m 644 -- "$source_dir/devops-practica.conf" "$site_conf"
fi
# Mark the switch as attempted before mv, so an error at ANY subsequent step
# will try to restore the old symlink before removing the candidate.
switched=1
swap_link "$nginx_dir/$new_slot.conf"
sudo -n nginx -t >/dev/null
sudo -n systemctl reload nginx

healthy=0
for (( attempt=0; attempt<10; attempt++ )); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$new_port/api/health" >/dev/null 2>&1 &&
       curl -fsS --max-time 2 -D - -o /dev/null http://127.0.0.1:80/api/health 2>/dev/null |
           tr -d '\r' | grep -Fxiq "X-Devops-Slot: $new_slot"; then
        healthy=1
        break
    fi
    sleep 2
done
(( healthy )) || { echo 'Health check through nginx failed; rolling back' >&2; exit 1; }
# The new slot now serves traffic. Never remove it if retirement of the old
# container fails: keeping an extra container is safer than causing downtime.
switched=0
new_started=0
new_attempted=0
if [[ -n "$previous" ]]; then
    case "$previous" in
        "$nginx_dir/blue.conf") old_slot=blue ;;
        "$nginx_dir/green.conf") old_slot=green ;;
    esac
    old_container="devops-practica-$old_slot"
    if docker container inspect "$old_container" >/dev/null 2>&1 &&
       [[ "$(docker inspect -f '{{ index .Config.Labels "app" }}' "$old_container")" == devops-practica ]]; then
        if ! docker stop --time 30 "$old_container" >/dev/null; then
            echo "Warning: previous container $old_container could not be stopped; review it manually" >&2
        fi
    fi
fi
echo "Deployed commit $image_sha on $new_slot; old container stopped when available (not deleted)"
