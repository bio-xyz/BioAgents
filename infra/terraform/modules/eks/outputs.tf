output "cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Kubernetes API server endpoint."
  value       = module.eks.cluster_endpoint
}

output "cluster_ca" {
  description = "Base64-encoded cluster CA certificate."
  value       = module.eks.cluster_certificate_authority_data
}

output "oidc_provider_arn" {
  description = "ARN of the cluster's IAM OIDC provider. Used to mint IRSA roles."
  value       = module.eks.oidc_provider_arn
}

output "oidc_provider_url" {
  description = "OIDC provider URL (without https://). Used as `aud`/`sub` source for IRSA trust."
  value       = module.eks.oidc_provider
}

output "cluster_security_group_id" {
  description = "Cluster-level security group ID."
  value       = module.eks.cluster_security_group_id
}
