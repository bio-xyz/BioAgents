resource "aws_s3_bucket" "loki" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "loki" {
  bucket = aws_s3_bucket.loki.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "loki" {
  bucket = aws_s3_bucket.loki.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "loki" {
  bucket = aws_s3_bucket.loki.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "loki" {
  bucket = aws_s3_bucket.loki.id

  rule {
    id     = "cold-backup-and-expire"
    status = "Enabled"

    filter {}

    # Hot tier (queryable through Loki/Grafana): STANDARD.
    # After glacier_transition_days, transition to GLACIER_IR for cold backup —
    # retrievable for incident forensics but ~85% cheaper than STANDARD.
    transition {
      days          = var.glacier_transition_days
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = var.retention_days
    }

    # Versioned bucket: noncurrent versions follow the same schedule so
    # accidental overwrites still get cold-tiered and eventually expire.
    noncurrent_version_transition {
      noncurrent_days = var.glacier_transition_days
      storage_class   = "GLACIER_IR"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.retention_days
    }

    # Abort incomplete multipart uploads after a week — they otherwise rack up
    # silent storage cost.
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
