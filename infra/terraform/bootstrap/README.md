# Bootstrap

One-time setup of the Terraform state backend. State for THIS module is local
(`terraform.tfstate` here). State for everything else lives in the S3 bucket
this module creates.

## Run

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

Outputs are the bucket name, lock-table name, and region. Plug them into the
`backend.tf` of every other config (already wired in `shared/` and `envs/*/`).

## Hands off after first apply

Don't `terraform destroy` this. The bucket has `prevent_destroy = true` and a
versioning policy, but the safer rule is: leave it alone. If you really need
to decommission, drop `prevent_destroy`, empty the bucket, then destroy.
