module.exports = {
  run: [{
    method: "shell.run",
    params: {
      conda: "conda_env",
      message: "conda clean -afy --yes"
    }
  }, {
    method: "notify",
    params: {
      html: "<div>Disk cleanup complete. Libraries deduplicated where possible.</div>"
    }
  }]
}
