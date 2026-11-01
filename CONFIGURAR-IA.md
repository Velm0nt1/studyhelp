# Configurar el Tutor IA de StudyHelp

## Sitio local

StudyHelp usa Ollama con Qwen 3 de 1.7B de forma local. Instala Ollama, ejecuta `ollama run qwen3:1.7b` una vez y deja Ollama abierto. Inicia StudyHelp con `node server.js`. Las preguntas se procesan en tu computadora.

## Sitio publicado en Render

Render no puede acceder al Ollama que está instalado en tu computadora. Para activar el Tutor IA público, StudyHelp usa Gemini 2.5 Flash-Lite si se configura su clave:

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/app/apikey).
2. En Render, abre el servicio StudyHelp y ve a **Environment → Add Environment Variable**.
3. Añade `GEMINI_API_KEY` con el valor de la clave. La clave debe estar guardada solo en Render, nunca en GitHub ni en el navegador. El código detecta automáticamente Gemini cuando está desplegado en Render.
4. Guarda y despliega de nuevo el servicio.

Google publica un nivel gratuito para Gemini 2.5 Flash-Lite, sujeto a límites que pueden cambiar. En el nivel gratuito, Google puede usar el contenido enviado para mejorar sus productos. No escribas datos personales o confidenciales en el Tutor IA. Revisa sus respuestas, porque puede equivocarse.

El historial de StudyHelp se guarda en el navegador del usuario. La clave API permanece en el servidor de Render y no se envía al navegador.

