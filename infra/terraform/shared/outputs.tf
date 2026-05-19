output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider in this AWS account."
  value       = aws_iam_openid_connect_provider.github_actions.arn
}

output "github_org" {
  description = "GitHub org name. Per-env modules use this to scope trust policies."
  value       = var.github_org
}
