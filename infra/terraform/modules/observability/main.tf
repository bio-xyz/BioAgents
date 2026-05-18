# Loki + Alloy installed via Helm. TF outputs (IRSA ARN, bucket name, region)
# are injected directly so the app-repo values.yaml files don't carry
# environment-specific secrets or PLACEHOLDER strings.

resource "kubernetes_namespace" "logging" {
  metadata {
    name = "logging"
    # PSS not enforced here — Loki/Alloy components don't all run with the
    # Restricted profile cleanly. The bioagents-* namespaces stay Restricted.
  }
}

resource "helm_release" "loki" {
  name             = "loki"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "loki"
  version          = var.loki_chart_version
  namespace        = kubernetes_namespace.logging.metadata[0].name
  create_namespace = false
  timeout          = 600

  # Layered values: base + TF-injected dynamic bits.
  values = [
    file(var.loki_base_values_path),
    yamlencode({
      serviceAccount = {
        create = true
        name   = "loki"
        annotations = {
          "eks.amazonaws.com/role-arn" = var.loki_irsa_role_arn
        }
      }
      loki = {
        storage = {
          type = "s3"
          bucketNames = {
            chunks = var.loki_bucket_name
            ruler  = var.loki_bucket_name
            admin  = var.loki_bucket_name
          }
          s3 = {
            region           = var.aws_region
            s3ForcePathStyle = false
            insecure         = false
          }
        }
      }
    }),
  ]
}

resource "helm_release" "alloy" {
  name             = "alloy"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "alloy"
  version          = var.alloy_chart_version
  namespace        = kubernetes_namespace.logging.metadata[0].name
  create_namespace = false
  timeout          = 300

  values = [
    file(var.alloy_base_values_path),
    yamlencode({
      alloy = {
        extraEnv = [
          {
            # SimpleScalable mode exposes the gateway Service on port 80.
            name  = "LOKI_URL"
            value = "http://loki-gateway.logging.svc/loki/api/v1/push"
          },
        ]
      }
    }),
  ]

  depends_on = [helm_release.loki]
}
