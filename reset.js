module.exports = {
  run: [{
    method: "shell.run",
    params: {
      message: [
        "rm -rf conda_env /tmp/bhashamedia_conda app/models/whisper-large-v3 app/models/xtts_v2 app/nltk_data app/outputs/* 2>/dev/null ; echo 'Reset done. Click Install again to rebuild everything from scratch.'"
      ]
    }
  }]
}
