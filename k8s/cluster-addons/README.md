# Cluster addons

Shared infrastructure installed once per cluster, separate from the Kustomize
worker manifests:

- **Loki** — log aggregation, simple-scalable mode, S3 chunks via IRSA on EKS,
  filesystem on kind.
- **Alloy** — log shipper (DaemonSet) reading container stdout and pushing to
  Loki.

## How they're installed

| Env | Installer | Where |
|---|---|---|
| `eks-staging`, `eks-prod` | Terraform (`helm_release`) | `infra/terraform/modules/observability/` |
| `kind` | `helm upgrade` from a workstation | manually, command below |

Terraform owns the EKS installs because it has the IRSA role ARN and S3 bucket
name in state and injects them via `set`-style overrides. On kind, where there
is no IRSA / S3, the install is one-line manual.

KEDA is **not** in this directory. It has no TF-output dependency, so it stays
as a manual `kubectl apply -f` (see `infra/README.md`).

## Values files

```
loki/
  values.yaml              # base — replicas, retention, ingestion limits
  values.kind.yaml         # kind override (filesystem storage, single-binary mode)
  values.eks-staging.yaml  # EKS staging override (smaller replicas)
  values.eks-prod.yaml     # EKS prod override (longer retention, higher limits)

alloy/
  values.yaml              # base
  values.kind.yaml         # kind override (LOKI_URL → single-binary endpoint)
```

The Loki/Alloy IRSA annotations and S3 bucket names are **not** in the EKS
values files — Terraform injects them dynamically. The kind values use
filesystem storage, no IRSA needed.

## Install on kind (manual)

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

kubectl create namespace logging
helm upgrade --install loki grafana/loki \
  -n logging \
  -f k8s/cluster-addons/loki/values.yaml \
  -f k8s/cluster-addons/loki/values.kind.yaml

helm upgrade --install alloy grafana/alloy \
  -n logging \
  -f k8s/cluster-addons/alloy/values.yaml \
  -f k8s/cluster-addons/alloy/values.kind.yaml
```

## Install on EKS

Run via Terraform — see `infra/README.md`. The relevant module is
`infra/terraform/modules/observability/`.

## Grafana

Not packaged here. Either run Grafana externally (Grafana Cloud) and point its
Loki data source at the in-cluster Service via a tunnel, or install
`grafana/grafana` into the `logging` namespace as a follow-up.
