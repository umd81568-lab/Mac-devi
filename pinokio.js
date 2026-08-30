const path = require('path')
module.exports = {
  version: "7.0",
  title: "BhashaMedia AI",
  description: "বাংলা ভিডিও অডিও এজেন্ট — ৭টি ফ্যাসিলিটি — 100% লোকাল",
  icon: "icon.png",
  menu: async (kernel, info) => {
    let installed = info.exists("conda_env") && info.exists("app/models/xtts_v2")
    let running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js"),
      link: info.running("link.js")
    }
    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing (models 4GB+ downloading…)",
        href: "install.js",
      }]
    } else if (installed) {
      if (running.start) {
        let local = info.local("start.js")
        if (local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-rocket",
            text: "Open Web UI",
            href: local.url,
          }, {
            icon: 'fa-solid fa-terminal',
            text: "Terminal",
            href: "start.js",
          }]
        } else {
          return [{
            default: true,
            icon: 'fa-solid fa-terminal',
            text: "Starting Gradio…",
            href: "start.js",
          }]
        }
      } else if (running.update) {
        return [{ default: true, icon: 'fa-solid fa-terminal', text: "Updating", href: "update.js" }]
      } else if (running.reset) {
        return [{ default: true, icon: 'fa-solid fa-terminal', text: "Resetting", href: "reset.js" }]
      } else if (running.link) {
        return [{ default: true, icon: 'fa-solid fa-terminal', text: "Deduplicating", href: "link.js" }]
      } else {
        return [{
          default: true,
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js",
        }, {
          icon: "fa-solid fa-plug",
          text: "Update",
          href: "update.js",
        }, {
          icon: "fa-solid fa-plug",
          text: "Re-Install (repair)",
          href: "install.js",
        }, {
          icon: "fa-solid fa-file-zipper",
          text: "<div><strong>Save Disk Space</strong><div>Deduplicate redundant library files</div></div>",
          href: "link.js",
        }, {
          icon: "fa-regular fa-circle-xmark",
          text: "<div><strong>Reset</strong><div>Revert to pre-install state</div></div>",
          href: "reset.js",
          confirm: "Are you sure you wish to reset BhashaMedia AI? This will delete conda_env and downloaded models."
        }]
      }
    } else {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Install (first run ~5 min)",
        href: "install.js",
      }]
    }
  }
}
