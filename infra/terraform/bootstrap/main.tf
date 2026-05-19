# Bootstrap module: creates the S3 bucket + DynamoDB table that all other
# Terraform configs use for remote state + locking. This module's own state is
# kept LOCAL (no backend block) — it's applied once and effectively never
# touched again.

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # Prevent accidental destroy; remove this only when intentionally
  # decommissioning the whole TF deployment.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Deny non-TLS access to the state bucket.
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.state.arn,
          "${aws_s3_bucket.state.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })
}

resource "aws_dynamodb_table" "lock" {
  # Orphaned: state locking moved to S3 native lockfiles (use_lockfile = true)
  # in all backend.tf files. This resource is being decommissioned in two steps:
  #   1. (this commit) prevent_destroy → false. Run `terraform apply` in
  #      bootstrap/ to update the lifecycle. Table stays.
  #   2. (follow-up commit) remove this whole resource block + the
  #      `lock_table_name` variable + the `lock_table_name` output. Apply again
  #      to destroy the table.
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = false
  }
}
