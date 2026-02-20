-- ============================================================
-- Agente Analizador de Leads
-- Trae 1 fila por lead (session_id) de los últimos 7 días
-- con su historial completo listo para procesar con LLM
-- ============================================================

SELECT 
  -- Identificador único del lead (número de teléfono)
  session_id,
  
  -- Cantidad total de mensajes en la conversación (humanos + IA)
  COUNT(*) AS total_mensajes,
  
  -- Primer mensaje de la semana (cuándo inició el contacto)
  MIN(created_at) AS primera_interaccion,
  
  -- Último mensaje (útil para detectar urgencia o leads recientes)
  MAX(created_at) AS ultima_interaccion,
  
  -- Solo los mensajes del cliente concatenados con separador " | "
  -- Útil para análisis rápido de intención sin ruido del bot
  string_agg(
    CASE 
      WHEN message->>'type' = 'human' 
      THEN (message->>'content')
    END,
    ' | '
    ORDER BY created_at
  ) FILTER (WHERE message->>'type' = 'human') AS mensajes_humanos,
  
  -- Historial completo con etiqueta Cliente/Agente separado por salto de línea
  -- Este es el campo que se le pasa al LLM para generar el resumen
  string_agg(
    CASE 
      WHEN message->>'type' = 'human' THEN 'Cliente: ' || (message->>'content')
      WHEN message->>'type' = 'ai'    THEN 'Agente: '  || (message->>'content')
    END,
    E'\n'                -- E'\n' = salto de línea real entre cada mensaje
    ORDER BY created_at  -- respeta el orden cronológico de la conversación
  ) FILTER (WHERE message->>'type' IN ('human', 'ai')) AS historial_completo

FROM n8n_chat_histories

WHERE 
  -- Solo conversaciones de los últimos 7 días
  created_at >= NOW() - INTERVAL '7 days'
  
  -- Excluir mensajes de herramientas/sistema, solo humano y IA
  AND message->>'type' IN ('human', 'ai')
  
  -- Descartar mensajes vacíos o nulos
  AND message->>'content' IS NOT NULL
  AND message->>'content' != ''

-- Agrupar por lead para obtener 1 fila por session_id
GROUP BY session_id

-- Filtro de calidad: descartar leads con menos de 2 mensajes humanos
-- (elimina sesiones de prueba, pings o conversaciones abandonadas)
HAVING COUNT(*) FILTER (WHERE message->>'type' = 'human') >= 2

-- Los leads más recientes primero (prioridad para el equipo de ventas)
ORDER BY ultima_interaccion DESC;
