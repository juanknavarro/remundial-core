# Backend - Remundial Core API

Servicio de backend asíncrono desarrollado con **FastAPI** y **SQLAlchemy 2.0 (AsyncIO)** para la gestión de créditos y cobranza en terreno.

---

## 📁 Estructura del Proyecto

```text
backend/
├── .env.example            # Plantilla de variables de entorno
├── .gitignore              # Archivos y carpetas ignorados por git
├── README.md               # Documentación y guía de despliegue local
├── requirements.txt        # Dependencias del proyecto
└── app/
    ├── __init__.py
    ├── main.py             # Instancia principal de FastAPI, CORS y registro de routers
    ├── core/               # Módulo central del sistema
    │   ├── __init__.py
    │   ├── config.py       # Configuración global y parseo de variables de entorno (Pydantic)
    │   └── database.py     # Motor asíncrono de base de datos (SQLAlchemy + asyncpg) y sesión get_db
    ├── models/             # Modelos ORM de base de datos
    │   ├── __init__.py
    │   └── usuario.py      # Modelo Usuario mapeado a la tabla 'usuarios' de init.sql
    ├── schemas/            # Esquemas de validación Pydantic (Input / Output)
    │   ├── __init__.py
    │   └── usuario.py      # Esquemas UsuarioCreate, UsuarioResponse, UsuarioUpdate
    └── routers/            # Controladores / Endpoints de la API
        ├── __init__.py
        ├── health.py       # Endpoint de verificación de salud y conectividad a PostgreSQL
        └── usuarios.py     # Endpoints CRUD para gestión de usuarios (GET /usuarios, POST /usuarios)
```

---

## 🚀 Requisitos Previos

- **Python 3.11+** (recomendado Python 3.12 o 3.13)
- **PostgreSQL 13+** con el script `/database/init.sql` previamente ejecutado.

---

## 🛠️ Instalación y Configuración Paso a Paso

### 1. Crear y activar un entorno virtual

#### En Windows (PowerShell):
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
```

*(Si PowerShell bloquea la ejecución de scripts, ejecuta antes: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`)*

#### En Linux / macOS:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
```

---

### 2. Instalar dependencias

Con el entorno virtual activado:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

### 3. Configurar variables de entorno

Copia el archivo `.env.example` a `.env`:

#### En Windows:
```powershell
Copy-Item .env.example .env
```

#### En Linux / macOS:
```bash
cp .env.example .env
```

Edita el archivo `.env` según tus credenciales de PostgreSQL:

```ini
PROJECT_NAME="Remundial Core API"
VERSION="1.0.0"
API_V1_STR="/api/v1"

# Credenciales de PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=tu_password
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=remundial_db

# O directamente la URL asíncrona:
DATABASE_URL=postgresql+asyncpg://postgres:tu_password@localhost:5432/remundial_db
```

---

### 4. Ejecutar el servidor en modo desarrollo

Inicia el servidor con recarga en caliente (**hot-reload**):

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📖 Documentación Interactiva

Una vez en ejecución, puedes acceder en tu navegador a:

- **Swagger UI (OpenAPI interactivo):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 📡 Endpoints Iniciales Disponibles

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/health` | Verifica estado del servicio y conectividad con la base de datos |
| `GET` | `/usuarios` | Lista usuarios con paginación (`skip`, `limit`) y filtros (`rol`, `estado_activo`) |
| `POST` | `/usuarios` | Registra un nuevo usuario con validación Pydantic |
| `GET` | `/usuarios/{usuario_id}` | Obtiene el detalle de un usuario por su UUID |
| `GET` | `/api/v1/health` | Versión prefijada de health check |
| `GET` | `/api/v1/usuarios` | Versión prefijada del listado de usuarios |
