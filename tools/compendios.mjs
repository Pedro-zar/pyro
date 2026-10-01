/**
 * O que os scripts de compêndio de poderes têm em comum: quais compêndios
 * existem, de que tipo é cada um e como um id nasce de um nome.
 *
 * Cada compêndio é um arquivo em tools/compendios/<nome>.yml, e o formato dele
 * está no cabeçalho que o importar-mundo.mjs escreve (ver CABECALHO).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { load } from "js-yaml";

export const RAIZ = path.resolve(import.meta.dirname, "..");
export const PASTA_YAML = path.join(RAIZ, "tools", "compendios");
export const PASTA_FONTE = path.join(RAIZ, "packs", "_source");

/** Nome do compêndio (o mesmo do system.json) → tipo de item que ele guarda. */
export const COMPENDIOS = {
  caminhos: { tipo: "caminho", rotulo: "Caminhos" },
  habilidades: { tipo: "habilidade", rotulo: "Habilidades" },
  tecnicas: { tipo: "tecnica", rotulo: "Técnicas" },
  feiticos: { tipo: "feitico", rotulo: "Feitiços" },
  magias: { tipo: "magia", rotulo: "Magias" },
  pericias: { tipo: "pericia", rotulo: "Perícias" }
};

export const compendioDoTipo = tipo =>
  Object.keys(COMPENDIOS).find(nome => COMPENDIOS[nome].tipo === tipo) ?? null;

/** Campos que uma entrada do YAML aceita. Chave fora desta lista é erro de digitação. */
export const CAMPOS_DA_ENTRADA = ["nome", "id", "pasta", "img", "system", "efeitos", "flags"];

/*
 * Os valores que o Foundry v14 dá a um efeito novo. O importador tira dos
 * efeitos o que é igual a eles, e o Foundry os devolve ao carregar.
 */
export const EFEITO_PADRAO = {
  img: "icons/svg/aura.svg",
  type: "base",
  disabled: false,
  start: null,
  duration: { value: null, units: "seconds", expiry: null, expired: false },
  description: "",
  origin: null,
  tint: "#ffffff",
  transfer: true,
  statuses: [],
  showIcon: 1,
  folder: null,
  sort: 0,
  flags: {}
};

/** O mesmo para cada linha de mudança de um efeito. */
export const MUDANCA_PADRAO = { type: "add", phase: "initial", priority: null };

/** Ícone que o Foundry põe num item sem imagem. */
export const IMG_ITEM_PADRAO = "icons/svg/item-bag.svg";

/**
 * Id estável de 16 caracteres: o mesmo nome dá sempre o mesmo id, então
 * compilar de novo não troca o documento que a mesa já arrastou para a ficha.
 */
export function idEstavel(...partes) {
  const hash = crypto.createHash("sha1").update(partes.join("|")).digest("hex");
  return BigInt(`0x${hash}`).toString(36).padStart(16, "0").slice(0, 16);
}

/**
 * As entradas de um arquivo de compêndio. Arquivo que só tem o cabeçalho
 * (nenhum item ainda) é uma lista vazia, e não um erro.
 */
export function lerCompendio(nome) {
  const arquivo = path.join(PASTA_YAML, `${nome}.yml`);
  if (!fs.existsSync(arquivo)) return [];
  const texto = fs.readFileSync(arquivo, "utf8");
  if (!texto.replace(/#.*$/gm, "").trim()) return [];
  return load(texto) ?? [];
}

/** Id no formato que o Foundry aceita: 16 letras ou números. */
export const idValido = id => typeof id === "string" && /^[a-zA-Z0-9]{16}$/.test(id);
