output "aws_region" {
  description = "Paste into GitHub Actions repo Variable AWS_REGION."
  value       = var.region
}

output "cluster_name" {
  description = "Paste into GitHub Actions repo Variable EKS_CLUSTER_NAME."
  value       = module.eks.cluster_name
}

output "deployer_role_arn" {
  description = "Paste into GitHub Actions repo Secret AWS_ROLE_PROD."
  value       = module.deployer_role.role_arn
}

output "loki_bucket_name" {
  description = "Loki S3 bucket. TF-injected into the Helm release — no manual paste needed."
  value       = module.loki_bucket.bucket_name
}

output "loki_irsa_role_arn" {
  description = "Loki IRSA role. TF-injected into the Helm release — no manual paste needed."
  value       = module.loki_irsa.role_arn
}

output "cluster_endpoint" {
  description = "EKS API endpoint (sensitive)."
  value       = module.eks.cluster_endpoint
  sensitive   = true
}
