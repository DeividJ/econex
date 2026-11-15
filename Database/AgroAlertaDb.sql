/*
  AgroAlerta - base inicial para SQL Server
  Ejecutar este archivo desde SQL Server Management Studio (SSMS).
  Crea una base de datos nueva llamada AgroAlertaDb.
*/
IF DB_ID(N'AgroAlertaDb') IS NULL
    CREATE DATABASE AgroAlertaDb;
GO

USE AgroAlertaDb;
GO

IF OBJECT_ID(N'dbo.Usuarios', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Usuarios (
        UsuarioId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Usuarios PRIMARY KEY,
        Nombre NVARCHAR(100) NOT NULL,
        Apellido NVARCHAR(100) NOT NULL,
        Email NVARCHAR(254) NOT NULL,
        PasswordHash NVARCHAR(500) NULL,
        Rol NVARCHAR(30) NOT NULL CONSTRAINT DF_Usuarios_Rol DEFAULT('Productor'),
        Activo BIT NOT NULL CONSTRAINT DF_Usuarios_Activo DEFAULT(1),
        FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_Usuarios_FechaAlta DEFAULT(SYSDATETIME()),
        CONSTRAINT UQ_Usuarios_Email UNIQUE(Email)
    );
END
GO

-- Usuario de demostración para la primera versión funcional (un único productor local).
-- La API inicial utiliza UsuarioId=1 hasta que incorporemos autenticación real.
IF NOT EXISTS (SELECT 1 FROM dbo.Usuarios WHERE UsuarioId=1)
BEGIN
    SET IDENTITY_INSERT dbo.Usuarios ON;
    INSERT dbo.Usuarios(UsuarioId,Nombre,Apellido,Email,Rol,Activo) VALUES(1,N'Productor',N'Demostración',N'demo@agroalerta.local',N'Productor',1);
    SET IDENTITY_INSERT dbo.Usuarios OFF;
END
GO

IF OBJECT_ID(N'dbo.Cultivos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Cultivos (
        CultivoId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Cultivos PRIMARY KEY,
        Nombre NVARCHAR(100) NOT NULL,
        Descripcion NVARCHAR(300) NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Cultivos_Activo DEFAULT(1)
    );
END
GO

IF OBJECT_ID(N'dbo.Parcelas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Parcelas (
        ParcelaId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Parcelas PRIMARY KEY,
        UsuarioId INT NOT NULL,
        CultivoId INT NULL,
        Nombre NVARCHAR(120) NOT NULL,
        Localidad NVARCHAR(120) NULL,
        Provincia NVARCHAR(100) NOT NULL CONSTRAINT DF_Parcelas_Provincia DEFAULT('Santiago del Estero'),
        Latitud DECIMAL(9,6) NULL,
        Longitud DECIMAL(9,6) NULL,
        SuperficieHectareas DECIMAL(12,2) NULL,
        FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_Parcelas_FechaAlta DEFAULT(SYSDATETIME()),
        Activa BIT NOT NULL CONSTRAINT DF_Parcelas_Activa DEFAULT(1),
        CONSTRAINT FK_Parcelas_Usuarios FOREIGN KEY(UsuarioId) REFERENCES dbo.Usuarios(UsuarioId),
        CONSTRAINT FK_Parcelas_Cultivos FOREIGN KEY(CultivoId) REFERENCES dbo.Cultivos(CultivoId)
    );
END
GO

IF OBJECT_ID(N'dbo.AnalisisRiesgos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AnalisisRiesgos (
        AnalisisId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AnalisisRiesgos PRIMARY KEY,
        UsuarioId INT NOT NULL,
        ParcelaId INT NULL,
        Latitud DECIMAL(9,6) NOT NULL,
        Longitud DECIMAL(9,6) NOT NULL,
        FechaAnalisis DATETIME2 NOT NULL CONSTRAINT DF_Analisis_Fecha DEFAULT(SYSDATETIME()),
        PeriodoDesde DATE NULL,
        PeriodoHasta DATE NULL,
        FuenteDatos NVARCHAR(100) NULL,
        Resumen NVARCHAR(1000) NULL,
        CONSTRAINT FK_Analisis_Usuarios FOREIGN KEY(UsuarioId) REFERENCES dbo.Usuarios(UsuarioId),
        CONSTRAINT FK_Analisis_Parcelas FOREIGN KEY(ParcelaId) REFERENCES dbo.Parcelas(ParcelaId)
    );
END
GO

IF OBJECT_ID(N'dbo.Alertas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Alertas (
        AlertaId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Alertas PRIMARY KEY,
        AnalisisId BIGINT NOT NULL,
        Tipo NVARCHAR(60) NOT NULL,
        Nivel NVARCHAR(30) NOT NULL,
        Titulo NVARCHAR(160) NOT NULL,
        Descripcion NVARCHAR(1000) NULL,
        Recomendacion NVARCHAR(1000) NULL,
        FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_Alertas_Fecha DEFAULT(SYSDATETIME()),
        CONSTRAINT FK_Alertas_Analisis FOREIGN KEY(AnalisisId) REFERENCES dbo.AnalisisRiesgos(AnalisisId)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Cultivos)
BEGIN
    INSERT INTO dbo.Cultivos (Nombre, Descripcion) VALUES
    (N'Soja', N'Cultivo agrícola'),
    (N'Maíz', N'Cultivo agrícola'),
    (N'Algodón', N'Cultivo agrícola'),
    (N'Sorgo', N'Cultivo agrícola'),
    (N'Girasol', N'Cultivo agrícola'),
    (N'Otro', N'Otro cultivo');
END
GO

PRINT N'Base AgroAlertaDb creada y estructura inicial verificada.';
GO
