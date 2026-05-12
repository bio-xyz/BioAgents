# BioAgents Infrastructure

Terraform-managed AWS foundation for the BioAgents EKS deployment. Spec:
[`../documentation/docs/K8S_WORKER_MIGRATION.md`](../documentation/docs/K8S_WORKER_MIGRATION.md).

## Layout

```
terraform/
├── bootstrap/    # one-time: S3 state bucket + DDB lock table (LOCAL state)
├── shared/       # account-wide: GitHub Actions OIDC provider
├── modules/      # reusable: vpc, eks, deployer-role, irsa-loki, loki-bucket, observability
└── envs/
    ├── staging/  # composes modules for bioagents-staging
    └── prod/     # composes modules for bioagents-prod
```

## Prerequisites

- Terraform >= 1.6 installed locally
- AWS CLI authenticated as an admin (or an admin-equivalent role via SSO)
- Region: `us-west-2`

## First-time setup (one-off)

### 1. Bootstrap the state backend

```bash
cd terraform/bootstrap
terraform init
terraform apply
```

Creates `s3://bioagents-tf-state` and DynamoDB table `bioagents-tf-state-lock`.
State for *this* module is local — never re-applied unless we're decommissioning.

### 2. Shared (account-wide)

```bash
cd ../shared
terraform init   # uses S3 backend
terraform apply
```

Creates the GitHub Actions OIDC provider. Outputs the ARN that per-env deployer
roles trust.

### 3. Staging

```bash
cd ../envs/staging
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars if you need to override defaults

terraform init

# First apply: bring the cluster up before Helm tries to talk to it.
terraform apply -target=module.eks

# Second apply: brings up everything else (IRSA, S3, Helm releases for Loki + Alloy).
terraform apply
```

The two-stage first apply works around the helm-provider-needs-cluster
chicken-and-egg. Subsequent `terraform apply` runs do not need `-target`.

### 4. Install KEDA on the new cluster (manual, one-line)

```bash
aws eks update-kubeconfig --name bioagents-staging --region us-west-2
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.18.1/keda-2.18.1-core.yaml
```

KEDA is not in Terraform because it has no TF-output dependency.

### 5. Wire outputs into GitHub Actions

```bash
terraform output deployer_role_arn   # → repo Secret AWS_ROLE_STAGING
terraform output cluster_name        # → repo Variable EKS_CLUSTER_NAME (if not already set)
terraform output aws_region          # → repo Variable AWS_REGION
```

Use the `gh` CLI:

```bash
gh secret set AWS_ROLE_STAGING --body "$(terraform output -raw deployer_role_arn)"
gh variable set EKS_CLUSTER_NAME --body "$(terraform output -raw cluster_name)"
gh variable set AWS_REGION --body "$(terraform output -raw aws_region)"
```

Loki's IRSA ARN and S3 bucket name are injected by Terraform — **no manual
paste needed**.

### 6. Prod — repeat steps 3-5 for `envs/prod`

```bash
cd ../prod
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply -target=module.eks
terraform apply

# KEDA
aws eks update-kubeconfig --name bioagents-prod --region us-west-2
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.18.1/keda-2.18.1-core.yaml

# GitHub Secrets
gh secret set AWS_ROLE_PROD --body "$(terraform output -raw deployer_role_arn)"
```

## Day-to-day

Routine changes: edit a `.tf` file, `terraform plan`, review, `terraform apply`.
No `-target` needed after the first apply.

`terraform plan` against a clean state shows zero diffs. Anything else is drift
worth understanding before applying.

## Recovery

### Failed first-apply

EKS bootstrap occasionally fails partway through (subnet quotas, IAM eventual
consistency, hit Amazon-side rate limits). Common pattern:

```bash
# See where it stopped
terraform plan

# If the cluster is partially up, re-run targeted at the cluster module
terraform apply -target=module.eks

# Then full apply
terraform apply
```

If state ends up genuinely broken: `terraform state list`, remove the
half-created resource with `terraform state rm`, fix it in AWS console, then
re-apply.

### State bucket lost or corrupted

The state bucket has versioning enabled. Recover the latest non-corrupt
version via the S3 console (Versions tab) or:

```bash
aws s3api list-object-versions --bucket bioagents-tf-state \
  --prefix envs/staging/terraform.tfstate
aws s3api get-object --bucket bioagents-tf-state \
  --key envs/staging/terraform.tfstate \
  --version-id <VERSION_ID> ./recovered.tfstate
terraform state push ./recovered.tfstate
```

### Helm release stuck

If `helm_release.loki` or `helm_release.alloy` get wedged (failed release,
"another operation in progress"):

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
- Tags: every resource gets `Project=bioagents`, `Env=<env>`, `Managed=terraform`.
- Naming: `bioagents-{env}-{component}` everywhere.
- VPC CIDRs are non-overlapping so we can peer envs later without renumbering.
