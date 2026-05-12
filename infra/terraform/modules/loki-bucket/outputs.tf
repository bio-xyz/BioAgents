output "bucket_name" {
  description = "S3 bucket name."
  value       = aws_s3_bucket.loki.id
}

output "bucket_arn" {
  description = "S3 bucket ARN. Used by the IRSA role policy."
  value       = aws_s3_bucket.loki.arn
}
