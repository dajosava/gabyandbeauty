# 🤖 Gaby & Beauty — AI Agent Suite - PANAMA

Sistema completo de automatización con IA para la academia de belleza **Gaby & Beauty** (Panamá), construido sobre N8N. Incluye un agente conversacional multimodal para WhatsApp y un agente analizador semanal de leads con reporte por correo.

---

## 📦 Flujos incluidos

| Archivo | Descripción |
|---|---|
| `Gaby_AI_RAG_-_PROD.json` | Agente conversacional WhatsApp (producción) |
| `Marketing_agent_Gaby_beauty.json` | Agente analizador de leads + reporte semanal |

---

## 🏗️ Arquitectura general

```
WhatsApp (Evolution API)
        ↓
   Webhook N8N
        ↓
  Human Label Check ──→ Si "atención humana": ignorar
        ↓
  Buffer Redis (7s) ──→ Agrupa mensajes rápidos
        ↓
  Switch tipo mensaje
    ├── Texto   → VictorIA Agent (OpenAI + Pinecone RAG)
    ├── Audio   → Transcripción (Whisper) → VictorIA Agent
    └── Imagen  → Análisis visual (GPT-4o) → VictorIA Agent
        ↓
  Guardrails → Filtro de seguridad
        ↓
  Registro automático de cliente (Data Table)
        ↓
  Respuesta por WhatsApp (Evolution API)
```

```
PostgreSQL (historial conversaciones)
        ↓
  Schedule Trigger (lunes 7am)
        ↓
  SQL Query → 1 fila por lead (últimos 7 días)
        ↓
  Loop Over Items (1 lead a la vez)
        ↓
  Lead Analysis Agent (Gemini / OpenAI)
        ↓
  Aggregate → junta todos los análisis
        ↓
  Code Node → Markdown a HTML email
        ↓
  Gmail → Reporte semanal
```

---

## 📁 Flujo 1: Gaby AI RAG — Agente Conversacional WhatsApp

### Descripción
Agente de atención al cliente 24/7 integrado con WhatsApp a través de Evolution API. Procesa mensajes de texto, audio e imágenes. Usa Pinecone como RAG para responder con información precisa del negocio.

### Capacidades
- ✅ Responde preguntas sobre cursos, precios, horarios, inscripciones
- ✅ Transcribe mensajes de voz y los procesa como texto
- ✅ Analiza imágenes enviadas por el cliente
- ✅ Memoria conversacional persistente en PostgreSQL
- ✅ Buffer de 7 segundos para agrupar mensajes consecutivos
- ✅ Detección de etiqueta "atención humana" para pausar el bot
- ✅ Registro automático de clientes nuevos
- ✅ Guardrails para filtrar contenido inapropiado
- ✅ Alerta por email ante intentos de ataque al sistema prompt

### Nodos principales

| Nodo | Tipo | Función |
|---|---|---|
| `Webhook` | Webhook | Recibe mensajes de Evolution API |
| `Check Human Label` | HTTP Request | Verifica si el chat tiene etiqueta humana activa |
| `if human tag is ON ignore` | Filter | Bloquea el flujo si hay agente humano activo |
| `Switch1` | Switch | Enruta por tipo de mensaje (texto / audio / imagen) |
| `Redis3 - Insertar mensaje` | Redis | Almacena el mensaje en caché |
| `Redis4 - Obtener mensaje` | Redis | Recupera mensajes del buffer |
| `Wait3` | Wait | Espera 7 segundos para agrupar mensajes |
| `Redis5 - Borrar mensaje de cache` | Redis | Limpia el buffer tras procesar |
| `Convert base64 a mp3` | Convert | Convierte audio recibido a MP3 |
| `Transcribe a recording` | OpenAI | Transcripción de voz a texto (Whisper) |
| `Obter mídia em base64` | Evolution API | Descarga media en base64 |
| `Convert base64 a jpg` | Convert | Convierte imagen recibida a JPG |
| `Analyze image` | OpenAI | Análisis visual con GPT-4o |
| `Guardrails` | Guardrails | Filtra mensajes maliciosos o fuera de scope |
| `VictorIA Agent` | AI Agent | Agente principal (OpenAI + herramientas) |
| `Think` | Tool Think | Razonamiento interno antes de responder |
| `Date & Time` | Tool | Provee fecha y hora actual al agente |
| `get_dates` | Code Tool | Calcula fechas de cursos dinámicamente |
| `Pinecone Assistant` | MCP Tool | RAG con base de conocimiento del negocio |
| `Chat memory DB` | Postgres Memory | Memoria conversacional persistente |
| `get_client` | Data Table | Busca si el cliente ya existe |
| `Switch - Cliente Existe` | Switch | Bifurca entre cliente nuevo y existente |
| `Insert_new_client` | Data Table | Registra cliente nuevo |
| `Update_client` | Data Table | Actualiza datos de cliente existente |
| `ADD TO TABLE` | Data Table | Registro adicional de interacción |
| `Marcar mensagens como lidas1` | Evolution API | Marca mensajes como leídos |
| `Enviar texto1` | Evolution API | Envía respuesta de texto por WhatsApp |
| `Evolution bot` | Evolution API | Nodo alternativo de envío |
| `notificar intento ataque` | Gmail | Alerta al equipo si detecta ataque al prompt |
| `Add Human Label` | HTTP Request | Agrega etiqueta humana al chat |
| `Remove Human Label` | HTTP Request | Remueve etiqueta humana del chat |
| `AI Agent` | AI Agent | Agente secundario (modo chat directo) |
| `Postgres Chat Memory` | Postgres Memory | Memoria del agente secundario |

### Flujo de procesamiento de texto (detallado)
```
Webhook → Check Human Label → if human tag is ON ignore
    ↓ (no ignorar)
Switch1 (tipo de mensaje)
    ↓ texto
Edit Fields → Merge1
    ↓
Redis3 (insertar) → Switch3
    ├── aún hay mensajes → Redis4 (obtener) → Wait 7s → loop
    └── todos procesados → Redis5 (borrar) → Edit Fields5
                                                    ↓
                                              Guardrails
                                                    ↓
                                            VictorIA Agent
                                        [Think + Date&Time + get_dates + Pinecone]
                                                    ↓
                                          Registro de cliente
                                                    ↓
                                          Enviar texto1 (WhatsApp)
```

### Herramientas del agente (VictorIA Agent)
- **Think** — Razonamiento paso a paso antes de responder
- **Date & Time** — Fecha y hora actual para referencias temporales
- **get_dates** — Función custom que calcula fechas dinámicas de cursos
- **Pinecone Assistant (MCP)** — Base de conocimiento vectorial con info de cursos, precios, horarios, materiales

---

## 📁 Flujo 2: Marketing Agent — Analizador Semanal de Leads

### Descripción
Agente que se ejecuta automáticamente cada lunes a las 7am. Consulta el historial de conversaciones de la última semana en PostgreSQL, analiza cada lead con IA, y genera un reporte HTML profesional enviado por correo al equipo de ventas.

### Capacidades
- ✅ Ejecución automática semanal (lunes 7am)
- ✅ Consulta leads de la última semana desde PostgreSQL
- ✅ Análisis individual por número de teléfono (session_id)
- ✅ Clasificación Hot / Warm / Cold con Intent Score 0-100
- ✅ Detección de intención de compra y objeciones
- ✅ Guiones de venta listos para copiar (Hot / Warm / Cold)
- ✅ Reporte HTML con links directos a WhatsApp por lead
- ✅ Envío automático por Gmail

### Nodos principales

| Nodo | Tipo | Función |
|---|---|---|
| `Schedule Trigger` | Schedule | Dispara cada lunes a las 7:00am |
| `Execute a SQL query` | Postgres | Trae conversaciones de los últimos 7 días |
| `Loop Over Items` | SplitInBatches | Procesa 1 lead a la vez (batch size: 1) |
| `Lead Analisis Agent` | AI Agent | Analiza la conversación y genera el reporte Markdown |
| `Simple Memory` | Memory Buffer | Memoria del agente por sesión |
| `OpenAI Chat Model` | LLM | Modelo de lenguaje (configurable: GPT / Gemini) |
| `Aggregate` | Aggregate | Junta todos los análisis en un array |
| `convert MD into HTML` | Code | Parsea Markdown → HTML optimizado para email |
| `Create Report` | HTML | Preview del reporte generado |
| `Send a message` | Gmail | Envía el reporte a manakinlabs@gmail.com |

### Query SQL de extracción de leads

```sql
SELECT 
  session_id,
  COUNT(*) AS total_mensajes,
  MIN(created_at) AS primera_interaccion,
  MAX(created_at) AS ultima_interaccion,
  string_agg(
    CASE WHEN message->>'type' = 'human' THEN (message->>'content') END,
    ' | ' ORDER BY created_at
  ) FILTER (WHERE message->>'type' = 'human') AS mensajes_humanos,
  string_agg(
    CASE 
      WHEN message->>'type' = 'human' THEN 'Cliente: ' || (message->>'content')
      WHEN message->>'type' = 'ai'    THEN 'Agente: '  || (message->>'content')
    END, E'\n' ORDER BY created_at
  ) FILTER (WHERE message->>'type' IN ('human', 'ai')) AS historial_completo
FROM n8n_chat_histories
WHERE 
  created_at >= NOW() - INTERVAL '7 days'
  AND message->>'type' IN ('human', 'ai')
  AND message->>'content' IS NOT NULL
  AND message->>'content' != ''
GROUP BY session_id
HAVING COUNT(*) FILTER (WHERE message->>'type' = 'human') >= 2
ORDER BY ultima_interaccion DESC;
```

### Estructura del reporte generado
El reporte HTML incluye:
- **Header** con rango de fechas de la semana
- **KPIs**: total leads, leads Hot, leads Warm, score promedio
- **Cards por lead** con:
  - Número de teléfono clickeable (link WhatsApp)
  - Badge de estado (Hot / Warm / Cold) y prioridad (P1 / P2 / P3)
  - Curso de interés y objeciones detectadas
  - Próxima acción recomendada
  - Mensaje listo para enviar por WhatsApp
  - Score circular visual
- **Insights semanales**: objeciones frecuentes, cursos más consultados, puntos de caída
- **Guiones por tipo** de lead (Hot / Warm / Cold)
- **Preguntas de calificación** sugeridas

---

## 🔧 Requisitos e integraciones

### Servicios externos requeridos

| Servicio | Uso | Plan recomendado |
|---|---|---|
| **Evolution API** | Gateway de WhatsApp | Self-hosted o cloud |
| **OpenAI** | LLM principal + Whisper + Vision | Pay-per-use |
| **Google Gemini** | LLM alternativo para análisis de leads | Free tier disponible |
| **Pinecone** | Base vectorial RAG | Free tier (1 index) |
| **Redis** | Buffer de mensajes | Free tier (Redis Cloud) |
| **PostgreSQL** | Memoria conversacional + datos de leads | Self-hosted o Supabase |
| **Gmail** | Envío de reportes y alertas | Cuenta Google |

### Variables de entorno / Credenciales en N8N

```
EVOLUTION_API_URL        URL base de tu instancia Evolution API
EVOLUTION_API_KEY        API Key de Evolution API
OPENAI_API_KEY           OpenAI API Key
GOOGLE_GEMINI_API_KEY    Google AI Studio API Key
PINECONE_API_KEY         Pinecone API Key
REDIS_URL                Redis connection string
POSTGRES_CONNECTION      PostgreSQL connection string
GMAIL_OAUTH              OAuth2 configurado en N8N para Gmail
```

---

## 🚀 Instalación

### 1. Clonar e importar flujos

```bash
git clone https://github.com/tu-usuario/gabybeauty-ai-agent.git
```

En N8N:
1. `Settings` → `Import workflow`
2. Importar `Gaby_AI_RAG_-_PROD.json`
3. Importar `Marketing_agent_Gaby_beauty.json`

### 2. Configurar credenciales

En N8N ve a `Settings` → `Credentials` y crea:

- **Evolution API** credential con tu URL y API Key
- **OpenAI** credential con tu API Key
- **Google Gemini** credential con tu API Key
- **Pinecone** credential (via MCP)
- **Redis** credential
- **PostgreSQL** credential
- **Gmail OAuth2** credential

### 3. Configurar la base de datos

Asegúrate de que la tabla `n8n_chat_histories` exista en PostgreSQL.
El nodo `memoryPostgresChat` la crea automáticamente al primer uso.

Para la tabla de clientes, ejecuta:

```sql
CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(100),
  telefono VARCHAR(30),
  email VARCHAR(100),
  primer_contacto TIMESTAMP DEFAULT NOW(),
  ultimo_contacto TIMESTAMP DEFAULT NOW(),
  curso_interes TEXT,
  estado VARCHAR(20) DEFAULT 'nuevo'
);
```

### 4. Configurar Evolution API

En el webhook de N8N, configura Evolution API para enviar eventos a:
```
https://tu-n8n.com/webhook/WEBHOOK_ID
```

Eventos requeridos:
- `messages.upsert`

### 5. Configurar Pinecone RAG

1. Crea un index en Pinecone
2. Sube los documentos del negocio (precios, temarios, horarios)
3. Conecta el MCP de Pinecone en el nodo `Pinecone Assistant`

### 6. Activar los flujos

1. Activar `Gaby_AI_RAG_-_PROD` → el agente comienza a responder WhatsApp
2. Activar `Marketing_agent_Gaby_beauty` → el reporte corre cada lunes 7am

---

## 📊 Estructura de datos

### Tabla `n8n_chat_histories` (auto-generada por N8N)

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | SERIAL | ID autoincremental |
| `session_id` | VARCHAR | Número de teléfono del cliente |
| `message` | JSONB | Mensaje con tipo (human/ai) y contenido |
| `created_at` | TIMESTAMP | Fecha y hora del mensaje |

### Clasificación de leads

| Score | Estado | Descripción |
|---|---|---|
| 80–100 | 🔴 Hot | Quiere inscribirse, preguntó por pagos o cupos |
| 50–79 | 🟠 Warm | Interés claro, necesita más info |
| 20–49 | 🔵 Cold | Curiosidad general sin compromiso |
| 0–19 | ⚫ No Lead | Sin intención real |

---

## 🛡️ Seguridad

- **Guardrails**: filtro automático de mensajes que intentan extraer el system prompt o manipular el agente
- **Human Label**: cualquier conversación puede ser tomada por un humano etiquetándola en Evolution API — el bot se pausa automáticamente
- **Email de alerta**: si se detecta un intento de ataque al sistema, se envía notificación al equipo

---

## 📁 Estructura del repositorio

```
gabybeauty-ai-agent/
├── README.md
├── workflows/
│   ├── Gaby_AI_RAG_-_PROD.json          # Agente WhatsApp producción
│   └── Marketing_agent_Gaby_beauty.json  # Agente análisis de leads
├── prompts/
│   └── system_prompt_lead_agent.md       # System prompt del analizador
├── sql/
│   └── query_leads_semanal.sql           # Query de extracción de leads
└── docs/
    └── architecture.png                  # Diagrama del flujo
```

---

## 🔄 Roadmap

- [ ] Dashboard web en tiempo real con métricas de leads
- [ ] Integración con CRM (HubSpot / Pipedrive)
- [ ] Seguimiento automático de leads Hot por WhatsApp
- [ ] Vectorización de resúmenes de leads en Pinecone para búsqueda semántica
- [ ] Soporte multiidioma (inglés)
- [ ] Webhook de cierre de venta para actualizar estado del lead

---

## 🧑‍💻 Desarrollado con

- [N8N](https://n8n.io) — Plataforma de automatización
- [Evolution API](https://evolution-api.com) — Gateway WhatsApp
- [OpenAI](https://openai.com) — GPT-4o + Whisper
- [Google Gemini](https://aistudio.google.com) — Análisis de leads
- [Pinecone](https://pinecone.io) — Base vectorial RAG
- [PostgreSQL](https://postgresql.org) — Memoria persistente
- [Redis](https://redis.io) — Buffer de mensajes

---

## 📄 Licencia

MIT — Libre para uso y modificación.
