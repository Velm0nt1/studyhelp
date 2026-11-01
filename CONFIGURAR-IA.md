# Configurar el Tutor IA gratis en StudyHelp

StudyHelp viene configurado para usar Ollama con Qwen 3 de 1.7B, ejecutado localmente. No necesitas cuenta, clave API ni pagar por pregunta. El modelo se descarga en tu computadora y las consultas se procesan allí; el equipo debe permanecer encendido y Ollama abierto para usar el Tutor IA.

## Preparación (solo una vez)

1. Instala Ollama para Windows desde [ollama.com/download/windows](https://ollama.com/download/windows).
2. Abre PowerShell y ejecuta `ollama run qwen3:1.7b`. La primera vez descarga el modelo (aprox. 1.4 GB); espera a que termine. Puedes escribir `/bye` para salir de esa conversación de prueba.
3. Inicia StudyHelp con `node server.js` y abre `http://localhost:4173`.
4. En Tutor IA debe aparecer “Tutor IA local listo”.

El archivo `.env.example` documenta los valores predeterminados; no hay que crear una clave. Si deseas cambiar el modelo, edita `OLLAMA_MODEL` en `.env`. Para usar una API con clave y posible costo, puedes poner `AI_PROVIDER=openai` y configurar `OPENAI_API_KEY` en el `.env` del servidor; nunca pegues la clave en la página ni la compartas en el chat.

El historial de StudyHelp se guarda en este navegador. El servidor local envía las preguntas a Ollama en `127.0.0.1`; no las manda a OpenAI cuando `AI_PROVIDER=ollama`.

