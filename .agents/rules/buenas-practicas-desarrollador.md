---
trigger: always_on
---

# Guía de Buenas Prácticas para el Desarrollo de Aplicaciones (Orientado a IA)

## 1. Principios Fundamentales

### 1.1 Claridad antes que complejidad
- Priorizar soluciones simples y mantenibles.
- Evitar abstracciones innecesarias.
- No introducir patrones si no hay un problema real que resolver.

### 1.2 Diseño orientado a escalabilidad
- Pensar desde el inicio en crecimiento de usuarios y datos.
- Separar claramente responsabilidades (backend, frontend, base de datos).
- Evitar dependencias rígidas entre módulos.

### 1.3 Seguridad por defecto
- No confiar nunca en el input del usuario.
- Aplicar validación tanto en frontend como en backend.
- Principio de mínimo privilegio en accesos y roles.

---

## 2. Arquitectura

### 2.1 Separación de responsabilidades
- Aplicar principios SOLID.
- Separar:
  - Capa de presentación
  - Lógica de negocio
  - Acceso a datos
- No mezclar lógica de negocio con detalles de infraestructura.

### 2.2 Modularidad
- Componentes desacoplados.
- Interfaces claras entre módulos.
- Facilitar testeo independiente.

### 2.3 Diseño orientado a dominio (si aplica)
- Modelos alineados con el negocio.
- Evitar lógica dispersa.
- Centralizar reglas de negocio críticas.

---

## 3. Código

### 3.1 Legibilidad
- Nombres descriptivos.
- Funciones pequeñas y con única responsabilidad.
- Evitar comentarios que expliquen *qué* hace el código; el código debe ser autoexplicativo.
- Usar comentarios solo para explicar *por qué*.

### 3.2 Consistencia
- Seguir una guía de estilo.
- Mantener convenciones uniformes en todo el proyecto.
- Estructura de carpetas clara y predecible.

### 3.3 Manejo de errores
- No ignorar excepciones.
- Log estructurado.
- Mensajes de error claros pero sin filtrar información sensible.
- No usar `try/catch` para ocultar problemas reales.

---

## 4. Testing

### 4.1 Cobertura inteligente
- Testear reglas de negocio críticas.
- Testear casos límite.
- No obsesionarse con cobertura 100% si no aporta valor.

### 4.2 Tipos de pruebas
- Unitarias para lógica pura.
- Integración para interacciones entre componentes.
- End-to-end para flujos críticos.

### 4.3 Principios
- Tests deterministas.
- Independientes entre sí.
- No depender de datos reales externos.

---

## 5. Base de Datos

### 5.1 Diseño
- Normalización adecuada (sin sobreoptimizar prematuramente).
- Índices bien definidos.
- Claves primarias claras.

### 5.2 Migraciones
- Versionar cambios de esquema.
- No modificar manualmente la base en producción.
- Migraciones reversibles si es posible.

### 5.3 Integridad
- Restricciones en base de datos además de validaciones en código.
- Evitar lógica crítica exclusivamente en la aplicación si puede garantizarse a nivel de base.

---

## 6. Seguridad

### 6.1 Autenticación y autorización
- Separar autenticación de autorización.
- Implementar control de acceso basado en roles (RBAC) o políticas.
- Nunca confiar en datos del cliente para decisiones de seguridad.

### 6.2 Protección de datos
- No almacenar secretos en el código.
- Uso de variables de entorno.
- Encriptación de datos sensibles en tránsito y en reposo.

### 6.3 Prevención de vulnerabilidades comunes
- Sanitizar inputs.
- Proteger contra:
  - SQL Injection
  - XSS
  - CSRF
- Actualizar dependencias regularmente.

---

## 7. Rendimiento

### 7.1 Medir antes de optimizar
- No optimizar sin métricas.
- Detectar cuellos de botella reales.

### 7.2 Buenas prácticas
- Lazy loading cuando aplique.
- Paginación en endpoints.
- Caching estratégico.
- Evitar consultas N+1.

---

## 8. Observabilidad

### 8.1 Logging
- Logs estructurados.
- Diferenciar niveles (info, warn, error).
- No loguear datos sensibles.

### 8.2 Métricas
- Tiempo de respuesta.
- Tasa de error.
- Uso de recursos.

### 8.3 Trazabilidad
- Identificadores de request.
- Seguimiento de eventos críticos.

---

## 9. DevOps y Entorno

### 9.1 Reproducibilidad
- Entornos consistentes (Docker si aplica).
- Infraestructura versionada (IaC).

### 9.2 CI/CD
- Build automatizado.
- Tests obligatorios antes de merge.
- Deploy automatizado y reversible.

### 9.3 Gestión de dependencias
- Versionado explícito.
- Evitar dependencias innecesarias.
- Revisar vulnerabilidades periódicamente.

---

## 10. Documentación

### 10.1 Técnica
- README claro.
- Instrucciones de despliegue.
- Arquitectura explicada de forma visual o estructural.

### 10.2 API
- Documentación formal (OpenAPI/Swagger si aplica).
- Ejemplos reales de request/response.

---

## 11. Principios para que una IA desarrolle correctamente

Cuando una IA implemente el sistema, debe:

1. Generar código completo, no fragmentos incompletos.
2. Mantener coherencia estructural entre archivos.
3. Proponer la solución más simple que cumpla requisitos.
4. Justificar decisiones arquitectónicas relevantes.
5. No asumir comportamientos implícitos.
6. Validar entradas de forma explícita.
7. Considerar casos límite.
8. Priorizar seguridad y mantenibilidad sobre rapidez.
9. Evitar sobreingeniería.
10. Ser explícita en dependencias, configuración y estructura.

---

## 12. Anti-Patrones a Evitar

- Lógica de negocio en controladores.
- Código duplicado.
- Funciones gigantes.
- Dependencias globales ocultas.
- Configuración hardcodeada.
- Optimización prematura.
- Falta de validación.
- Ausencia de tests en lógica crítica.

---

## 13. Checklist Final

Antes de considerar la aplicación lista:

- [ ] Arquitectura clara y modular
- [ ] Seguridad revisada
- [ ] Tests cubren reglas críticas
- [ ] Logs adecuados
- [ ] Variables sensibles fuera del código
- [ ] Migraciones versionadas
- [ ] Documentación actualizada
- [ ] Sin código muerto
- [ ] Sin duplicidades evidentes
- [ ] Revisado bajo criterios de simplicidad

---

**Objetivo final:**  
Construir un sistema seguro, mantenible, escalable y comprensible, evitando complejidad innecesaria y priorizando claridad estructural.