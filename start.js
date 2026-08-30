module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        env: {
          "PYTORCH_ENABLE_MPS_FALLBACK": "1",
          "HF_HUB_OFFLINE": "1",
          "NLTK_DATA": "{{cwd}}/app/nltk_data",
          "GRADIO_SERVER_PORT": "{{port}}",
          "GRADIO_SERVER_NAME": "127.0.0.1"
        },
        message: [
          "python app.py"
        ],
        on: [{
          "event": "/http:\/\/[0-9.:]+/",
          "done": true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[0]}}"
      }
    }
  ]
}
