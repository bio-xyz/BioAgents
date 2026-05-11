# Cluster addons

Shared infrastructure installed once per cluster, separate from the Kustomize
worker manifests. Currently:

- **Loki** — log aggregation, simple-scalable mode, S3 chunks via IRSA on EKS,
  filesystem on kind.
- **Alloy** — log shipper (DaemonSet) reading container stdout and pushing to
  Loki.

Both are installed via Helm so we get the upstream chart defaults plus minimal
overrides. We don't try to template them through Kustomize — Helm values are
the right knob.

## Install order

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# Namespace + Loki
kubectl create namespace logging
helm upgrade --install loki grafana/loki \
  -n logging \
  -f k8s/cluster-addons/loki/values.yaml \
  -f k8s/cluster-addons/loki/values.<env>.yaml   # env-specific overrides

# Alloy DaemonSet (writes to the Loki Service above)
helm upgrade --install alloy grafana/alloy \
  -n logging \
  -f k8s/cluster-addons/alloy/values.yaml
```

`<env>` is `kind`, `eks-staging`, or `eks-prod`. The env override file pins
the storage backend (filesystem vs S3) and the S3 bucket / IRSA role ARN.

## EKS prerequisites

- S3 bucket for Loki chunks (per env, e.g. `bioagents-loki-prod`).
- IAM role with bucket read/write, trusted by the cluster's OIDC provider
  for `system:serviceaccount:logging:loki`. The role ARN goes into the env
  values file as a ServiceAccount annotation
  (`eks.amazonaws.com/role-arn`).
- Provisioning of those lives in the Terraform workstream.

## Grafana

Not packaged here. Either:
- run Grafana externally (e.g., Grafana Cloud) and point its Loki data source
  at the in-cluster Loki Service via a tunnel / VPN, or
- install `grafana/grafana` into the same `logging` namespace (follow-up).

## kind local notes

The kind values pin everything to filesystem storage and 1 replica per
component so it fits a single node. Don't run kind addons against a real S3
bucket; the values.kind.yaml override disables S3 entirely.
