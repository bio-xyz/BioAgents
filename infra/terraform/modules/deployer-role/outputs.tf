output "role_arn" {
  description = "IAM role ARN. Paste into GitHub Actions Secrets as AWS_ROLE_STAGING or AWS_ROLE_PROD."
  value       = aws_iam_role.deployer.arn
}

output "role_name" {
  description = "IAM role name."
  value       = aws_iam_role.deployer.name
}
