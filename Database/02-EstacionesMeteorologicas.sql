/*
  AgroAlerta - módulo Estación meteorológica (instalación incremental)
  Ejecutar UNA VEZ desde SSMS sobre AgroAlertaDb existente.
  No elimina ni altera las tablas anteriores.
*/
USE AgroAlertaDb;
GO
IF OBJECT_ID(N'dbo.EstacionesMeteorologicas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EstacionesMeteorologicas (
        EstacionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EstacionesMeteorologicas PRIMARY KEY,
        UsuarioId INT NOT NULL,
        ParcelaId INT NULL,
        Nombre NVARCHAR(120) NOT NULL,
        Marca NVARCHAR(100) NOT NULL,
        Modelo NVARCHAR(100) NOT NULL,
        ModoConexion NVARCHAR(20) NOT NULL,
        ClaveHash CHAR(64) NOT NULL,
        FechaAltaUtc DATETIME2 NOT NULL CONSTRAINT DF_Estaciones_Fecha DEFAULT(SYSUTCDATETIME()),
        Activa BIT NOT NULL CONSTRAINT DF_Estaciones_Activa DEFAULT(1),
        CONSTRAINT FK_Estaciones_Usuarios FOREIGN KEY(UsuarioId) REFERENCES dbo.Usuarios(UsuarioId),
        CONSTRAINT FK_Estaciones_Parcelas FOREIGN KEY(ParcelaId) REFERENCES dbo.Parcelas(ParcelaId),
        CONSTRAINT CK_Estaciones_Modo CHECK (ModoConexion IN ('directa','pasarela'))
    );
END
GO
IF OBJECT_ID(N'dbo.LecturasMeteorologicas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LecturasMeteorologicas (
        LecturaId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LecturasMeteorologicas PRIMARY KEY,
        EstacionId INT NOT NULL,
        FechaMedicionUtc DATETIME2 NOT NULL,
        FechaRecepcionUtc DATETIME2 NOT NULL CONSTRAINT DF_Lecturas_Recepcion DEFAULT(SYSUTCDATETIME()),
        TemperaturaC FLOAT NULL,
        HumedadPct FLOAT NULL,
        LluviaMm FLOAT NULL,
        VientoKmh FLOAT NULL,
        PresionHpa FLOAT NULL,
        EsPrueba BIT NOT NULL CONSTRAINT DF_Lecturas_Prueba DEFAULT(0),
        CONSTRAINT FK_Lecturas_Estaciones FOREIGN KEY(EstacionId) REFERENCES dbo.EstacionesMeteorologicas(EstacionId)
    );
    CREATE INDEX IX_Lecturas_Estacion_Fecha ON dbo.LecturasMeteorologicas(EstacionId, FechaRecepcionUtc DESC);
END
GO
PRINT N'Módulo de estaciones meteorológicas instalado.';
GO
