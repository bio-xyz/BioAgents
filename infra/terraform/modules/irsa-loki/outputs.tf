output "role_arn" {
  description = "IRSA role ARN. Injected into the loki ServiceAccount annotation."
  value       = aws_iam_role.loki.arn
}
