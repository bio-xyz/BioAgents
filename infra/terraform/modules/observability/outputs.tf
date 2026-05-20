output "namespace" {
  description = "Namespace Loki + Alloy run in."
  value       = kubernetes_namespace.logging.metadata[0].name
}

output "loki_release_status" {
  description = "Helm release status for Loki."
  value       = helm_release.loki.status
}

output "alloy_release_status" {
  description = "Helm release status for Alloy."
  value       = helm_release.alloy.status
}
