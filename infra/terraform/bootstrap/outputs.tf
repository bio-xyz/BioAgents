output "state_bucket_name" {
  description = "S3 bucket for Terraform state. Reference from backend blocks."
  value       = aws_s3_bucket.state.id
}

output "lock_table_name" {
  description = "DynamoDB table for Terraform state locks."
  value       = aws_dynamodb_table.lock.name
}

output "region" {
  description = "AWS region the backend lives in."
  value       = var.region
}
