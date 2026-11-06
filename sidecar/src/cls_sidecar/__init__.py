"""Chumps Lab Studio ML sidecar."""

from cls_sidecar.paths import configure_cache_env

# Runs before any submodule imports a model library, so downloads land on D:.
configure_cache_env()
