module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        message: [
          "uv pip install --upgrade -r requirements.txt",
          "/tmp/bhashamedia_conda/bin/python -m pip install --upgrade TTS==0.22.0 2>&1 | tail -10"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        message: [
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-large-v3', local_dir='models/whisper-large-v3', local_dir_use_symlinks=False, resume_download=True)\"",
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('coqui/XTTS-v2', local_dir='models/xtts_v2', local_dir_use_symlinks=False, resume_download=True)\""
        ]
      }
    }
  ]
}
