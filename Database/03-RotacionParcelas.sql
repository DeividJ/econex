-- AgroAlerta: ampliación no destructiva de dbo.Parcelas para polígonos.
-- Opcional: el nuevo endpoint también intenta aplicar estas columnas al primer uso.
-- Ejecutar conectado a AgroAlertaDb si el usuario SQL no puede alterar tablas automáticamente.
USE AgroAlertaDb;
GO
IF COL_LENGTH('dbo.Parcelas','Pais') IS NULL ALTER TABLE dbo.Parcelas ADD Pais NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.Parcelas','AltitudMetros') IS NULL ALTER TABLE dbo.Parcelas ADD AltitudMetros DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.Parcelas','RegionAgro') IS NULL ALTER TABLE dbo.Parcelas ADD RegionAgro NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Parcelas','SubregionAgro') IS NULL ALTER TABLE dbo.Parcelas ADD SubregionAgro NVARCHAR(120) NULL;
IF COL_LENGTH('dbo.Parcelas','PoligonoGeoJson') IS NULL ALTER TABLE dbo.Parcelas ADD PoligonoGeoJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.Parcelas','PhSuelo') IS NULL ALTER TABLE dbo.Parcelas ADD PhSuelo DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.Parcelas','SodioPorcentaje') IS NULL ALTER TABLE dbo.Parcelas ADD SodioPorcentaje DECIMAL(5,2) NULL;
IF COL_LENGTH('dbo.Parcelas','ConductividadElectrica') IS NULL ALTER TABLE dbo.Parcelas ADD ConductividadElectrica DECIMAL(6,2) NULL;
IF COL_LENGTH('dbo.Parcelas','ColorContorno') IS NULL ALTER TABLE dbo.Parcelas ADD ColorContorno NVARCHAR(7) NULL;
GO
PRINT N'Campos de geometría agregados a Parcelas sin perder datos existentes.';
