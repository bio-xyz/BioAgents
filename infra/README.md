# BioAgents Infrastructure

Terraform-managed AWS foundation for the BioAgents EKS deployment. Spec:
[`../documentation/docs/K8S_WORKER_MIGRATION.md`](../documentation/docs/K8S_WORKER_MIGRATION.md).

One shared EKS cluster, two namespaces (`bioagents-staging`, `bioagents-prod`).
Isolation comes from per-namespace ResourceQuotas, per-branch IAM deployer
roles, and separate Redis/Supabase data planes — not from cluster boundaries.

## Layout

```
terraform/
├── bootstrap/    # one-time: S3 state bucket (LOCAL state)
├── shared/       # account-wide: GitHub Actions OIDC provider
├── modules/      # reusable: vpc, eks, deployer-role, irsa-loki, loki-bucket, observability
└── cluster/      # the cluster: 1 VPC + 1 EKS + 1 Loki + 2 deployer roles + 2 namespaces
```

## Prerequisites

- Terraform >= 1.10 (requires `use_lockfile = true` for the S3 backend)
- AWS CLI authenticated as an admin (or admin-equivalent SSO role)
- Region: `us-west-2`
- EC2 vCPU service quota raised to cover the node group (see step 3)

## First-time setup

### 1. Bootstrap the state backend

```bash
cd terraform/bootstrap
terraform init
terraform apply
```

Creates `s3://bioagents-tf-state`. State for *this* module is local — never
re-applied unless you're decommissioning.

### 2. Shared (account-wide)

```bash
cd ../shared
terraform init
terraform apply
```

Creates the GitHub Actions OIDC provider. The cluster config consumes its
output via `terraform_remote_state`.

### 3. Raise the EC2 vCPU quota

The default new-account quota (5 vCPU for the standard family) can't fit the
node group. Request a bump *before* applying the cluster:

```bash
aws service-quotas request-service-quota-increase \
  --service-code ec2 \
  --quota-code L-1216C47A \
  --desired-value 32 \
  --region us-west-2
```

Approval is usually minutes to a few hours. Poll:

```bash
aws service-quotas list-requested-service-quota-change-history \
  --service-code ec2 --region us-west-2 \
  --query 'RequestedQuotas[?QuotaCode==`L-1216C47A`].[QuotaName,Status,DesiredValue]' \
  --output table
```

Wait for `Status` to flip to `CASE_CLOSED` (or check the dashboard).

### 4. Apply the cluster

```bash
cd ../cluster
cp terraform.tfvars.example terraform.tfvars   # edit overrides if needed
terraform init

# 4a. Apply the VPC explicitly. Without this, -target=module.eks only pulls in
#     vpc_id + subnet_ids — the NAT gateway, IGW, and route tables aren't on
#     EKS's dependency path, so they'd be skipped and the nodes would fail to
#     join the cluster.
terraform apply -target=module.vpc

# 4b. Apply the EKS cluster + node group.
terraform apply -target=module.eks

# 4c. Full apply: namespaces, quotas, Loki/Alloy via Helm, IRSA wiring.
terraform apply
```

The split apply works around the helm-provider-needs-cluster chicken-and-egg.
Subsequent runs (re-apply, drift fixes, version bumps) don't need `-target`.

### 5. Install KEDA on the cluster

Not in Terraform because it has no TF-output dependency:

```bash
aws eks update-kubeconfig --name bioagents --region us-west-2
kubectl apply --server-side \
  -f https://github.com/kedacore/keda/releases/download/v2.18.1/keda-2.18.1-core.yaml
```

### 6. Wire outputs into GitHub Actions

```bash
gh secret set AWS_ROLE_STAGING   --body "$(terraform output -raw deployer_role_staging_arn)"
gh secret set AWS_ROLE_PROD      --body "$(terraform output -raw deployer_role_prod_arn)"
gh variable set EKS_CLUSTER_NAME --body "$(terraform output -raw cluster_name)"
gh variable set AWS_REGION       --body "$(terraform output -raw aws_region)"

# Per-env config and secret env files for the workers:
gh secret set CONFIG_ENV_STAGING < /path/to/staging/config.env
gh secret set SECRET_ENV_STAGING < /path/to/staging/secret.env
gh secret set CONFIG_ENV_PROD    < /path/to/prod/config.env
gh secret set SECRET_ENV_PROD    < /path/to/prod/secret.env

# GHCR pull token (classic PAT with read:packages):
gh secret set GHCR_PULL_PAT      --body "<token>"
```

Loki's IRSA ARN and S3 bucket name are injected directly by Terraform — no
manual paste needed.

## Day-to-day

Routine changes: edit a `.tf` file, `terraform plan`, review, `terraform apply`.
No `-target` needed after the first apply.

`terraform plan` against a clean state shows zero diffs. Anything else is drift
worth understanding before applying.

## Migrating from the old `envs/staging` + `envs/prod` layout

If you have an existing `envs/staging` state from before the consolidation:

```bash
# Restore the deleted .tf files into the working tree (state is still in S3)
git show HEAD~:infra/terraform/envs/staging/main.tf      > infra/terraform/envs/staging/main.tf
git show HEAD~:infra/terraform/envs/staging/variables.tf > infra/terraform/envs/staging/variables.tf
# ...etc. for backend.tf, outputs.tf, versions.tf

cd infra/terraform/envs/staging
terraform init
# If the failed node group is still in state, remove it so destroy proceeds:
terraform state rm 'module.eks.module.eks.module.eks_managed_node_group["workers-ondemand"].aws_eks_node_group.this[0]' 2>/dev/null || true
terraform destroy
rm -rf infra/terraform/envs/
```

Then run steps 4–6 above against `cluster/`.

## Recovery

### Failed first-apply

EKS bootstrap occasionally fails partway through (subnet quotas, IAM eventual
consistency, EC2 fleet quota). Common pattern:

```bash
terraform plan                              # see where it stopped
terraform apply -target=module.eks          # finish the cluster
terraform apply                             # then the rest
```

If state ends up broken: `terraform state list`, remove the half-created
resource with `terraform state rm`, fix it in AWS console, then re-apply.

### State bucket lost or corrupted

The state bucket has versioning enabled. Recover the latest non-corrupt
version via the S3 console (Versions tab) or:

```bash
aws s3api list-object-versions --bucket bioagents-tf-state \
  --prefix cluster/terraform.tfstate
aws s3api get-object --bucket bioagents-tf-state \
  --key cluster/terraform.tfstate \
  --version-id <VERSION_ID> ./recovered.tfstate
terraform state push ./recovered.tfstate
```

### Helm release stuck

If `helm_release.loki` or `helm_release.alloy` get wedged:

```bash
helm -n logging list
helm -n logging uninstall loki   # or alloy
terraform apply                  # re-creates
```

If TF state diverges from cluster reality:

```bash
terraform state rm module.observability.helm_release.loki
terraform apply
```

## Conventions

- Module versions pinned with `~>` in each module's `versions.tf`. Upgrade
  during quarterly maintenance.
- Tags: every resource gets `Project=bioagents`, `Managed=terraform`.
- Naming: cluster `bioagents`, namespaces `bioagents-{staging,prod}`, deployer
  roles `bioagents-deployer-{staging,prod}`, Loki bucket `bioagents-loki`.
- State lock: S3 native lockfile (`use_lockfile = true`). No DynamoDB.
