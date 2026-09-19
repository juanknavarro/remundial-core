-- ============================================================================
-- SISTEMA DE GESTIÓN DE CRÉDITOS Y COBRANZA EN TERRENO
-- Script de Inicialización: init.sql
-- Motor: PostgreSQL 13+
-- Descripción:
--   Estructura DDL completa con integridad referencial estricta, tipos UUID,
--   soporte para geolocalización GPS, índices de rendimiento para llaves foráneas
--   e idempotencia en su ejecución.
-- ============================================================================

-- Habilitar extensión para generación de identificadores únicos universales (UUID)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TIPOS ENUMERADOS (ENUMs) CON IDEMPOTENCIA
-- ============================================================================

DO $$
BEGIN
    -- Roles permitidos en el sistema
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario_enum') THEN
        CREATE TYPE rol_usuario_enum AS ENUM ('master', 'supervisor', 'secretaria', 'vendedor', 'cobrador');
    END IF;

    -- Clasificación de referencias personales del cliente
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_referencia_enum') THEN
        CREATE TYPE tipo_referencia_enum AS ENUM ('familiar', 'codeudor');
    END IF;

    -- Ciclo de vida de un crédito
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_credito_enum') THEN
        CREATE TYPE estado_credito_enum AS ENUM ('pendiente', 'activo', 'terminado', 'mora');
    END IF;

    -- Frecuencia o modalidad de pago de las cuotas
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_pago_enum') THEN
        CREATE TYPE tipo_pago_enum AS ENUM ('diario', 'semanal', 'quincenal', 'mensual');
    END IF;

    -- Estados de procesamiento y auditoría de los recaudos/abonos
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_abono_enum') THEN
        CREATE TYPE estado_abono_enum AS ENUM ('registrado', 'conciliado', 'anulado');
    END IF;
END$$;


-- ============================================================================
-- 2. TABLAS PRINCIPALES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabla: usuarios
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    rol rol_usuario_enum NOT NULL,
    telefono VARCHAR(25),
    estado_activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE usuarios IS 'Personal de la empresa: supervisores, secretarias, vendedores y cobradores.';
COMMENT ON COLUMN usuarios.id IS 'Identificador único del usuario (UUID v4).';
COMMENT ON COLUMN usuarios.rol IS 'Rol asignado para control de acceso y asignación operativa en créditos y cobranza.';
COMMENT ON COLUMN usuarios.estado_activo IS 'Bandera de activación lógica para habilitar o inhabilitar acceso al sistema.';


-- ----------------------------------------------------------------------------
-- Tabla: clientes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cedula VARCHAR(30) NOT NULL UNIQUE,
    nombres VARCHAR(150) NOT NULL,
    telefono VARCHAR(25),
    direccion TEXT NOT NULL,
    barrio VARCHAR(100),
    ciudad VARCHAR(100) NOT NULL,
    coordenadas_gps POINT, -- Convención nativa PostgreSQL: POINT(longitud, latitud) -> (X, Y)
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE clientes IS 'Titulares de los créditos otorgados y destinatarios de la gestión en terreno.';
COMMENT ON COLUMN clientes.cedula IS 'Documento nacional de identidad único para evitar duplicidad de clientes.';
COMMENT ON COLUMN clientes.coordenadas_gps IS 'Punto geográfico del domicilio comercial o residencial del cliente (POINT: X=longitud, Y=latitud).';


-- ----------------------------------------------------------------------------
-- Tabla: referencias_cliente
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referencias_cliente (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL,
    tipo tipo_referencia_enum NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    cedula VARCHAR(30),
    telefono VARCHAR(25),
    direccion TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_referencias_cliente_cliente
        FOREIGN KEY (cliente_id)
        REFERENCES clientes (id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

COMMENT ON TABLE referencias_cliente IS 'Contactos de respaldo del cliente (familiares y codeudores solidarios).';
COMMENT ON COLUMN referencias_cliente.cliente_id IS 'Llave foránea hacia el cliente titular. Si se elimina el cliente, sus referencias se eliminan en cascada.';


-- ----------------------------------------------------------------------------
-- Tabla: productos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    precio_base NUMERIC(12, 2) NOT NULL CHECK (precio_base >= 0),
    es_precio_variable BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE productos IS 'Catálogo de artículos financiables (incluye obras de arte de precio negociable).';
COMMENT ON COLUMN productos.sku IS 'Código de inventario único del producto.';
COMMENT ON COLUMN productos.precio_base IS 'Precio de catálogo de referencia.';
COMMENT ON COLUMN productos.es_precio_variable IS 'Indica si el producto (ej. obras de arte) permite pactar un precio diferente al precio_base.';


-- ----------------------------------------------------------------------------
-- Tabla: creditos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creditos (
    id_contrato UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL,
    vendedor_id UUID NOT NULL,
    supervisor_id UUID,
    cobrador_id UUID,
    estado estado_credito_enum NOT NULL DEFAULT 'pendiente',
    tipo_pago tipo_pago_enum NOT NULL,
    cuota_inicial NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cuota_inicial >= 0),
    monto_financiado NUMERIC(12, 2) NOT NULL CHECK (monto_financiado > 0),
    numero_cuotas INTEGER NOT NULL CHECK (numero_cuotas > 0),
    valor_cuota NUMERIC(12, 2) NOT NULL CHECK (valor_cuota > 0),
    fecha_primera_cuota DATE NOT NULL,
    saldo_pendiente NUMERIC(12, 2) NOT NULL CHECK (saldo_pendiente >= 0),
    numero_contrato VARCHAR(50),
    ciudad_venta VARCHAR(100),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Integridad referencial estricta: No se permite eliminar participantes clave con créditos registrados
    CONSTRAINT fk_creditos_cliente
        FOREIGN KEY (cliente_id)
        REFERENCES clientes (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_creditos_vendedor
        FOREIGN KEY (vendedor_id)
        REFERENCES usuarios (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_creditos_supervisor
        FOREIGN KEY (supervisor_id)
        REFERENCES usuarios (id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_creditos_cobrador
        FOREIGN KEY (cobrador_id)
        REFERENCES usuarios (id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

COMMENT ON TABLE creditos IS 'Contratos de financiamiento otorgados a los clientes.';
COMMENT ON COLUMN creditos.id_contrato IS 'Identificador único del contrato de crédito (UUID v4).';
COMMENT ON COLUMN creditos.cliente_id IS 'Cliente titular del crédito (ON DELETE RESTRICT).';
COMMENT ON COLUMN creditos.vendedor_id IS 'Asesor comercial que cerró la colocación del crédito.';
COMMENT ON COLUMN creditos.supervisor_id IS 'Supervisor que aprueba o audita el crédito (ON DELETE SET NULL si el usuario es dado de baja).';
COMMENT ON COLUMN creditos.cobrador_id IS 'Cobrador en terreno asignado actualmente a la ruta de este crédito.';
COMMENT ON COLUMN creditos.saldo_pendiente IS 'Balance restante por recaudar; se actualiza conforme se registran abonos.';


-- ----------------------------------------------------------------------------
-- Tabla: credito_detalle
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credito_detalle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credito_id UUID NOT NULL,
    producto_id UUID NOT NULL,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    valor_unitario_acordado NUMERIC(12, 2) NOT NULL CHECK (valor_unitario_acordado >= 0),
    subtotal NUMERIC(12, 2) GENERATED ALWAYS AS (cantidad * valor_unitario_acordado) STORED,

    CONSTRAINT fk_credito_detalle_credito
        FOREIGN KEY (credito_id)
        REFERENCES creditos (id_contrato)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_credito_detalle_producto
        FOREIGN KEY (producto_id)
        REFERENCES productos (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT uq_credito_producto
        UNIQUE (credito_id, producto_id)
);

COMMENT ON TABLE credito_detalle IS 'Artículos que componen el contrato de crédito (líneas de detalle).';
COMMENT ON COLUMN credito_detalle.subtotal IS 'Valor calculado automáticamente (cantidad * valor_unitario_acordado) y almacenado físicamente.';
COMMENT ON COLUMN credito_detalle.valor_unitario_acordado IS 'Precio unitario pactado al momento de la venta, permitiendo variación en obras de arte.';


-- ----------------------------------------------------------------------------
-- Tabla: abonos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abonos (
    id_recibo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credito_id UUID NOT NULL,
    cobrador_id UUID NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valor_abonado NUMERIC(12, 2) NOT NULL CHECK (valor_abonado > 0),
    coordenadas_gps_cobro POINT, -- Convención nativa PostgreSQL: POINT(longitud, latitud) -> (X, Y)
    estado estado_abono_enum NOT NULL DEFAULT 'registrado',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_abonos_credito
        FOREIGN KEY (credito_id)
        REFERENCES creditos (id_contrato)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_abonos_cobrador
        FOREIGN KEY (cobrador_id)
        REFERENCES usuarios (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

COMMENT ON TABLE abonos IS 'Comprobantes de recaudo efectuados en terreno por los cobradores.';
COMMENT ON COLUMN abonos.id_recibo IS 'Identificador único del recibo de recaudo (UUID v4).';
COMMENT ON COLUMN abonos.coordenadas_gps_cobro IS 'Ubicación física exacta capturada al momento del cobro (POINT: X=longitud, Y=latitud).';
COMMENT ON COLUMN abonos.estado IS 'Ciclo de conciliación contable del dinero recaudado.';


-- ============================================================================
-- 3. ÍNDICES DE RENDIMIENTO Y OPTIMIZACIÓN (B-TREE & GIST)
-- ============================================================================

-- Usuarios
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_estado_activo ON usuarios (estado_activo);

-- Clientes
CREATE INDEX IF NOT EXISTS idx_clientes_ciudad_barrio ON clientes (ciudad, barrio);
-- Índice espacial GiST para geocercas y búsquedas de proximidad en clientes
CREATE INDEX IF NOT EXISTS idx_clientes_coordenadas_gps ON clientes USING gist (coordenadas_gps);

-- Referencias Cliente (FK lookup)
CREATE INDEX IF NOT EXISTS idx_referencias_cliente_cliente_id ON referencias_cliente (cliente_id);

-- Productos
CREATE INDEX IF NOT EXISTS idx_productos_es_precio_variable ON productos (es_precio_variable);

-- Créditos (FK lookups y filtros operativos frecuentes)
CREATE INDEX IF NOT EXISTS idx_creditos_cliente_id ON creditos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_creditos_vendedor_id ON creditos (vendedor_id);
CREATE INDEX IF NOT EXISTS idx_creditos_supervisor_id ON creditos (supervisor_id);
CREATE INDEX IF NOT EXISTS idx_creditos_cobrador_id ON creditos (cobrador_id);
CREATE INDEX IF NOT EXISTS idx_creditos_estado ON creditos (estado);
CREATE INDEX IF NOT EXISTS idx_creditos_fecha_primera_cuota ON creditos (fecha_primera_cuota);
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_numero_contrato ON creditos (numero_contrato) WHERE numero_contrato IS NOT NULL AND TRIM(numero_contrato) != '';
CREATE INDEX IF NOT EXISTS idx_creditos_numero_contrato ON creditos (numero_contrato);
CREATE INDEX IF NOT EXISTS idx_creditos_ciudad_venta ON creditos (ciudad_venta);

-- Detalle Crédito (FK lookups)
CREATE INDEX IF NOT EXISTS idx_credito_detalle_credito_id ON credito_detalle (credito_id);
CREATE INDEX IF NOT EXISTS idx_credito_detalle_producto_id ON credito_detalle (producto_id);

-- Abonos (FK lookups, ordenamiento cronológico e índice espacial GiST de auditoría en terreno)
CREATE INDEX IF NOT EXISTS idx_abonos_credito_id ON abonos (credito_id);
CREATE INDEX IF NOT EXISTS idx_abonos_cobrador_id ON abonos (cobrador_id);
CREATE INDEX IF NOT EXISTS idx_abonos_fecha ON abonos (fecha);
CREATE INDEX IF NOT EXISTS idx_abonos_estado ON abonos (estado);
-- Índice espacial GiST para verificar si el cobro se hizo en el domicilio del cliente
CREATE INDEX IF NOT EXISTS idx_abonos_coordenadas_gps_cobro ON abonos USING gist (coordenadas_gps_cobro);
