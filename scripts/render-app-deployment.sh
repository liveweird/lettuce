#!/usr/bin/env bash

set -euo pipefail

readonly PLACEHOLDER='LETTUCE_APP_IMAGE_REQUIRED'
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly TEMPLATE="$SCRIPT_DIR/../k8s/templates/app-deployment.yaml"

usage() {
    printf 'Usage: %s REGISTRY/REPOSITORY@sha256:DIGEST\n' "${0##*/}" >&2
}

fail() {
    printf 'render-app-deployment: %s\n' "$1" >&2
    exit 1
}

if [[ $# -ne 1 ]]; then
    usage
    fail 'exactly one immutable application image reference is required'
fi

readonly IMAGE_REF="$1"
readonly IMAGE_PATTERN='^((localhost|[a-z0-9]+([.-][a-z0-9]+)*\.[a-z0-9]+([.-][a-z0-9]+)*)(:[0-9]+)?)(/[a-z0-9]+([._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$'

if [[ ! "$IMAGE_REF" =~ $IMAGE_PATTERN ]]; then
    fail 'image must be a lowercase REGISTRY/REPOSITORY@sha256 reference with an explicit dotted registry host (or localhost) and a 64-character digest; tags and local image names are rejected'
fi

[[ -f "$TEMPLATE" ]] || fail "deployment template not found: $TEMPLATE"

readonly PLACEHOLDER_COUNT="$(awk -v placeholder="$PLACEHOLDER" '{ count += gsub(placeholder, placeholder) } END { print count + 0 }' "$TEMPLATE")"
[[ "$PLACEHOLDER_COUNT" == '1' ]] || fail "deployment template must contain exactly one $PLACEHOLDER sentinel"

readonly IMAGE_LINE_COUNT="$(awk -v placeholder="$PLACEHOLDER" '$1 == "image:" && $2 == placeholder && NF == 2 { count++ } END { print count + 0 }' "$TEMPLATE")"
[[ "$IMAGE_LINE_COUNT" == '1' ]] || fail 'deployment template sentinel must be the complete image value on exactly one image field'

readonly DEPLOYMENT_COUNT="$(awk '$1 == "kind:" && $2 == "Deployment" && NF == 2 { count++ } END { print count + 0 }' "$TEMPLATE")"
[[ "$DEPLOYMENT_COUNT" == '1' ]] || fail 'deployment template must contain exactly one Deployment resource'

readonly APP_CONTAINER_COUNT="$(awk '$1 == "name:" && $2 == "lettuce-app" && NF == 2 { count++ } END { print count + 0 }' "$TEMPLATE")"
[[ "$APP_CONTAINER_COUNT" == '1' ]] || fail 'deployment template must contain exactly one lettuce-app container'

readonly TOTAL_IMAGE_COUNT="$(awk '$1 == "image:" { count++ } END { print count + 0 }' "$TEMPLATE")"
[[ "$TOTAL_IMAGE_COUNT" == '1' ]] || fail 'deployment template must contain exactly one container image field'

# This is deliberately a validator for the controlled template shape, not a general YAML parser.
# Bind the sentinel and container name to the same, sole item under spec.template.spec.containers;
# lexical field counts alone would allow moving the image into metadata or another mapping.
if ! awk -v placeholder="$PLACEHOLDER" '
    $0 == "      containers:" {
        container_sections++
        in_containers = 1
        current_item = 0
        next
    }
    in_containers && $0 ~ /^      [^ ]/ {
        in_containers = 0
        current_item = 0
    }
    in_containers && $0 ~ /^        - / {
        container_items++
        current_item = container_items
    }
    in_containers && current_item == 1 && $0 == "          image: " placeholder {
        associated_images++
    }
    in_containers && current_item == 1 && $0 == "          name: lettuce-app" {
        associated_names++
    }
    END {
        valid = container_sections == 1 && container_items == 1 && associated_images == 1 && associated_names == 1
        exit(valid ? 0 : 1)
    }
' "$TEMPLATE"; then
    fail 'deployment template must bind the image sentinel to the sole lettuce-app container item'
fi

readonly PULL_POLICY_COUNT="$(awk '$1 == "imagePullPolicy:" && $2 == "IfNotPresent" && NF == 2 { count++ } END { print count + 0 }' "$TEMPLATE")"
[[ "$PULL_POLICY_COUNT" == '1' ]] || fail 'deployment template must contain exactly one imagePullPolicy: IfNotPresent field'

readonly RENDERED="$(mktemp "${TMPDIR:-/tmp}/lettuce-app-deployment.XXXXXX")"
trap 'rm -f "$RENDERED"' EXIT

awk -v placeholder="$PLACEHOLDER" -v image_ref="$IMAGE_REF" '
    $1 == "image:" && $2 == placeholder && NF == 2 {
        sub(placeholder, image_ref)
        replacements++
    }
    { print }
    END {
        if (replacements != 1) {
            exit 1
        }
    }
' "$TEMPLATE" >"$RENDERED" || fail 'failed to render deployment template'

grep -Fq "$PLACEHOLDER" "$RENDERED" && fail 'rendered deployment retained the unresolved image sentinel'
readonly RENDERED_IMAGE_COUNT="$(awk -v image_ref="$IMAGE_REF" '$1 == "image:" && $2 == image_ref && NF == 2 { count++ } END { print count + 0 }' "$RENDERED")"
[[ "$RENDERED_IMAGE_COUNT" == '1' ]] || fail 'rendered deployment does not contain the exact requested image digest'

cat "$RENDERED"
