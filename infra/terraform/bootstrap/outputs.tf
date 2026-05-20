output "state_bucket_name" {
  description = "S3 bucket for Terraform state. Reference from backend blocks."
  value       = aws_s3_bucket.state.id
}

output "region" {
  description = "AWS region the backend lives in."
  value       = var.region
}
