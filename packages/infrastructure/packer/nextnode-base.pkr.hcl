packer {
  required_plugins {
    hcloud = {
      version = ">= 1.6.0"
      source  = "github.com/hetznercloud/hcloud"
    }
  }
}

variable "infra_fingerprint" {
  type        = string
  description = "Content-addressed hash of the Packer source files. Used as snapshot label for cache lookup."
}

source "hcloud" "nextnode-base" {
  image       = "debian-12"
  location    = "nbg1"
  server_type = "cx23"
  ssh_username = "root"

  snapshot_name = "nextnode-base-${var.infra_fingerprint}"

  snapshot_labels = {
    managed_by        = "nextnode-packer"
    infra_fingerprint = var.infra_fingerprint
  }
}

build {
  sources = ["source.hcloud.nextnode-base"]

  provisioner "shell" {
    script = "scripts/setup.sh"
  }

  provisioner "shell" {
    inline = [
      "apt-get clean",
      "rm -rf /var/lib/apt/lists/* /tmp/*",
      "cloud-init clean --logs",
      "fstrim --all || true",
      "sync"
    ]
  }
}
