/**
 * Transforma o pyro-export.json (ver tools/exportar-mundo.macro.js) nos
 * arquivos de tools/compendios/, um por compêndio.
 *
 * A limpeza é o que separa o que foi escrito de propósito do que o Foundry
 * preenche sozinho: campos iguais ao padrão do tipo saem, junto com a
 * contabilidade do mundo (datas, dono, origem de cópia). O Foundry devolve os
 * padrões ao carregar o compêndio, então nada se perde, e o arquivo fica com
 * o que dá para ler e editar.
 *
 * Por padrão só ACRESCENTA: item cujo id já está no arquivo fica como está,
 * para uma exportação nova não desfazer o que foi editado à mão. Com
 * --substituir os arquivos são reescritos do zero a partir da exportação.
 *
 *   node tools/importar-mundo.mjs tools/pyro-export.json [--substituir]
 */
import fs from "node:fs";
import path from "node:path";
import { dump } from "js-yaml";
import {
  RAIZ, PASTA_YAML, COMPENDIOS, compendioDoTipo, EFEITO_PADRAO, MUDANCA_PADRAO, IMG_ITEM_PADRAO,
  lerCompendio
} from "./compendios.mjs";

const args = process.argv.slice(2);
const substituir = args.includes("--substituir");
const arquivo = path.resolve(RAIZ, args.find(a => !a.startsWith("--")) ?? "tools/pyro-export.json");
if (!fs.existsSync(arquivo)) {
  console.error(`Não achei ${arquivo}. Rode a macro de tools/exportar-mundo.macro.js no Foundry antes.`);
  process.exit(1);
}
const exportado = JSON.parse(fs.readFileSync(arquivo, "utf8"));

/* -------------------------------------------------------------------------- */
/*  Diferença contra o padrão                                                 */
/* -------------------------------------------------------------------------- */

const ehObjeto = v => v !== null && typeof v === "object" && !Array.isArray(v);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * O que em `valor` é diferente de `padrao`. Objetos descem campo a campo;
 * listas valem inteiras, porque metade de uma lista não tem sentido sozinha.
 * Devolve undefined quando não sobra nada.
 */
function diferenca(valor, padrao) {
  if (ehObjeto(valor) && ehObjeto(padrao)) {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      const d = chave in padrao ? diferenca(v, padrao[chave]) : v;
      if (d !== undefined) saida[chave] = d;
    }
    return Object.keys(saida).length ? saida : undefined;
  }
  return igual(valor, padrao) ? undefined : valor;
}

/** Flags sem o rastro de cópia do núcleo e sem objetos vazios. */
function limparFlags(flags) {
  const saida = foundryClone(flags ?? {});
  if (saida.core) {
    delete saida.core.sourceId;
    if (!Object.keys(saida.core).length) delete saida.core;
  }
  for (const [chave, v] of Object.entries(saida)) {
    if (ehObjeto(v) && !Object.keys(v).length) delete saida[chave];
  }
  return Object.keys(saida).length ? saida : undefined;
}

const foundryClone = v => JSON.parse(JSON.stringify(v));

/* -------------------------------------------------------------------------- */
/*  Pastas                                                                    */
/* -------------------------------------------------------------------------- */

const pastas = new Map((exportado.pastas ?? []).map(p => [p._id, p]));

/** "Elfo/Transformações": o caminho da pasta, da raiz até ela. */
function caminhoDaPasta(id) {
  const nomes = [];
  const vistos = new Set();
  let atual = pastas.get(id);
  while (atual && !vistos.has(atual._id)) {
    vistos.add(atual._id);
    nomes.unshift(atual.name.replaceAll("/", "-"));
    atual = pastas.get(atual.folder);
  }
  return nomes.join("/");
}

/** Ordem das pastas como estão no mundo, para o arquivo sair na mesma ordem. */
function chaveDeOrdem(item) {
  const cadeia = [];
  let atual = pastas.get(item.folder);
  while (atual) {
    cadeia.unshift(String(atual.sort ?? 0).padStart(12, "0") + atual.name);
    atual = pastas.get(atual.folder);
  }
  cadeia.push(String(item.sort ?? 0).padStart(12, "0") + item.name);
  return cadeia.join("/");
}

/* -------------------------------------------------------------------------- */
/*  Limpeza                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * O que um item carrega da ficha em que viveu e não faz sentido num
 * compêndio: o progresso de quem usou, ids de outros itens daquela ficha e
 * marcas pessoais. Cada linha diz o caminho dentro de system e por quê.
 */
const ESTADO_DA_FICHA = {
  todos: [
    ["progresso.nivel", "nível de quem usou"],
    ["progresso.contadores", "usos de quem usou"]
  ],
  habilidade: [
    ["nivel", "nível de quem usou"],
    ["adormecida", "estado do Despertar de quem tinha"],
    ["aparencia", "retrato e token de um personagem"]
  ],
  caminho: [["xp", "xp de quem tinha"]],
  tecnica: [["ataque.id", "id da arma de uma ficha"], ["postura.id", "id da postura de uma ficha"]]
};

/** Flags pessoais, que valem para quem marcou e não para o item. */
const FLAGS_DA_FICHA = ["favorito"];

/*
 * Prazo de um efeito que vale enquanto o item existir. O construtor antigo
 * gravava um prazo de 6 segundos nesses efeitos (o "Infinity" virando
 * fórmula), e prazo nenhum faz sentido num efeito que mora no item.
 */
const PRAZO_DO_EFEITO = ["prazoFormula", "prazo", "turnos", "rodadas"];

const SISTEMA = exportado.sistema;
/** O compêndio grava "pyro" no lugar do id do sistema; o build põe o id certo. */
const ESCOPO = "pyro";

function apagarCaminho(objeto, caminho) {
  const partes = caminho.split(".");
  const ultimo = partes.pop();
  const pai = partes.reduce((o, p) => (ehObjeto(o) ? o[p] : undefined), objeto);
  if (ehObjeto(pai) && ultimo in pai) {
    delete pai[ultimo];
    return true;
  }
  return false;
}

/** Tira os objetos que ficaram vazios depois da limpeza. */
function podar(valor) {
  if (!ehObjeto(valor)) return valor;
  for (const [chave, v] of Object.entries(valor)) {
    const podado = podar(v);
    if (ehObjeto(podado) && !Object.keys(podado).length) delete valor[chave];
  }
  return valor;
}

/** systems/pyro-dev/icons/x.svg vira systems/pyro/icons/x.svg. */
const imagemNeutra = img => (typeof img === "string" && SISTEMA
  ? img.replace(`systems/${SISTEMA}/`, `systems/${ESCOPO}/`) : img);

/** As flags do sistema sob "pyro", sem vazios, falsos nem marcas pessoais. */
function flagsNeutras(flags, { efeito = null } = {}) {
  const saida = limparFlags(flags);
  if (!saida) return undefined;
  if (SISTEMA && SISTEMA !== ESCOPO && saida[SISTEMA]) {
    saida[ESCOPO] = saida[SISTEMA];
    delete saida[SISTEMA];
  }
  const nossas = saida[ESCOPO];
  if (ehObjeto(nossas)) {
    for (const [chave, v] of Object.entries(nossas)) {
      const vazio = v === null || v === false || (Array.isArray(v) && !v.length);
      if (vazio || FLAGS_DA_FICHA.includes(chave)) delete nossas[chave];
    }
    if (efeito && !nossas.deUso) for (const chave of PRAZO_DO_EFEITO) delete nossas[chave];
    // Item específico se reconhece pelo nome em qualquer ficha; o id é o
    // da ficha de onde o efeito veio (ver efeitoValeParaItem).
    for (const alvo of nossas.alvosItem ?? []) if (!alvo.tipo && alvo.nome) delete alvo.id;
    if (!Object.keys(nossas).length) delete saida[ESCOPO];
  }
  return Object.keys(saida).length ? saida : undefined;
}

function limparMudanca(mudanca) {
  const saida = { key: mudanca.key, value: mudanca.value };
  for (const [chave, v] of Object.entries(mudanca)) {
    if (chave === "key" || chave === "value") continue;
    if (chave in MUDANCA_PADRAO && igual(v, MUDANCA_PADRAO[chave])) continue;
    saida[chave] = v;
  }
  return saida;
}

function limparEfeito(efeito) {
  const { _id, _stats, name, system, start, ...resto } = efeito;
  const saida = { id: _id, name };
  const outros = diferenca(resto, EFEITO_PADRAO) ?? {};
  // A origem aponta para o item do mundo, que o compêndio não conhece.
  delete outros.origin;
  const deUso = !!efeito.flags?.[SISTEMA]?.deUso;
  if (!deUso) delete outros.duration;
  if (outros.img) outros.img = imagemNeutra(outros.img);
  const mudancas = (system?.changes ?? []).map(limparMudanca);
  const sistema = { ...(system ?? {}), changes: mudancas };
  if (!mudancas.length) delete sistema.changes;
  if (Object.keys(sistema).length) saida.system = sistema;
  delete outros.flags;
  const flags = flagsNeutras(efeito.flags, { efeito: true });
  return { ...saida, ...outros, ...(flags ? { flags } : {}) };
}

/** Elementos de lista com padrão conhecido: o que for igual a ele sai. */
const PADRAO_DO_ELEMENTO = {
  runas: { itemId: "", subjulgar: false, tipoDano: "" }
};

function limparSistema(item, limpo) {
  for (const [caminho] of [...ESTADO_DA_FICHA.todos, ...(ESTADO_DA_FICHA[item.type] ?? [])]) {
    apagarCaminho(limpo, caminho);
  }
  // O id do caminho de origem é o da ficha; "geral" é a única marca que vale.
  if (item.type === "habilidade" && limpo.caminho !== "geral") delete limpo.caminho;
  // Uma runa da magia se acha pelo nome na ficha de quem conjura.
  for (const [lista, padrao] of Object.entries(PADRAO_DO_ELEMENTO)) {
    if (!Array.isArray(limpo[lista])) continue;
    limpo[lista] = limpo[lista].map(el => (ehObjeto(el)
      ? Object.fromEntries(Object.entries(el).filter(([k, v]) => !(k in padrao && (k === "itemId" || igual(v, padrao[k])))))
      : el));
  }
  if (ehObjeto(limpo.custosCustom)) {
    for (const [chave, v] of Object.entries(limpo.custosCustom)) if (!v) delete limpo.custosCustom[chave];
  }
  return podar(limpo);
}

function entradaDoItem(item, rotulo) {
  const padrao = exportado.padroes?.[item.type] ?? {};
  const entrada = { nome: item.name, id: item._id };
  // A pasta com o nome do compêndio é redundante dentro dele.
  const partes = caminhoDaPasta(item.folder).split("/").filter(Boolean);
  if (partes[0] === rotulo) partes.shift();
  if (partes.length) entrada.pasta = partes.join("/");
  const iconeDoTipo = `systems/${SISTEMA}/icons/${item.type}.svg`;
  if (item.img && item.img !== IMG_ITEM_PADRAO && item.img !== iconeDoTipo) {
    entrada.img = imagemNeutra(item.img);
  }
  const sistema = diferenca(limparSistema(item, foundryClone(item.system ?? {})), padrao);
  if (sistema && Object.keys(sistema).length) entrada.system = sistema;
  const efeitos = (item.effects ?? []).map(limparEfeito);
  if (efeitos.length) entrada.efeitos = efeitos;
  const flags = flagsNeutras(item.flags);
  if (flags) entrada.flags = flags;
  return entrada;
}

/* -------------------------------------------------------------------------- */
/*  Escrita                                                                   */
/* -------------------------------------------------------------------------- */

const CABECALHO = rotulo => `# Compêndio "${rotulo}" do PYRO.
#
# Cada item é uma entrada da lista. \`npm run build\` gera o compêndio a partir
# daqui: edite, compile e o Foundry mostra a versão nova depois de recarregar.
#
#   nome:     obrigatório.
#   id:       16 letras ou números. Sem ele, o id sai do nome e da pasta, e
#             trocar um dos dois troca o id. Depois de criado, não mude.
#   pasta:    pastas do compêndio separadas por "/", como "Elfo/Formas".
#   img:      caminho da imagem. Sem ela, fica o ícone do tipo. "systems/pyro/"
#             vira o id do sistema no build.
#   system:   só os campos que fogem do padrão do tipo. O que faltar vem do
#             padrão ao carregar, então não precisa escrever campo vazio.
#   efeitos:  os efeitos ativos, no formato do Foundry (name, system.changes,
#             disabled, transfer...). id segue a mesma regra do item.
#   flags:    flags do item, se houver. As do sistema ficam sob "pyro", e o
#             build troca pelo id do sistema.
#
# Para copiar um item feito no mundo, exporte de novo com a macro e rode
# \`npm run importar\`: o que já está aqui não é tocado, só entra o que é novo.
`;

/** As entradas como texto YAML, com uma linha em branco entre um item e outro. */
const textoDasEntradas = entradas => (entradas.length
  ? dump(entradas, { lineWidth: -1, noRefs: true }).replace(/\n- nome:/g, "\n\n- nome:")
  : "");

/*
 * Acrescentar escreve só no fim do arquivo: os comentários e a arrumação de
 * quem editou à mão continuam onde estavam.
 */
function escreverYaml(nome, entradas, { acrescentar = false } = {}) {
  fs.mkdirSync(PASTA_YAML, { recursive: true });
  const destino = path.join(PASTA_YAML, `${nome}.yml`);
  if (acrescentar && fs.existsSync(destino)) {
    if (!entradas.length) return;
    const atual = fs.readFileSync(destino, "utf8").replace(/\s*$/, "");
    fs.writeFileSync(destino, `${atual}\n\n${textoDasEntradas(entradas)}`);
    return;
  }
  fs.writeFileSync(destino, `${CABECALHO(COMPENDIOS[nome].rotulo)}\n${textoDasEntradas(entradas)}`);
}

/* -------------------------------------------------------------------------- */

const porCompendio = Object.fromEntries(Object.keys(COMPENDIOS).map(n => [n, []]));
const ignorados = {};
for (const item of [...(exportado.itens ?? [])].sort((a, b) =>
  chaveDeOrdem(a).localeCompare(chaveDeOrdem(b)))) {
  const nome = compendioDoTipo(item.type);
  if (!nome) {
    ignorados[item.type] = (ignorados[item.type] ?? 0) + 1;
    continue;
  }
  porCompendio[nome].push(entradaDoItem(item, COMPENDIOS[nome].rotulo));
}

console.log(`Exportação de ${exportado.exportado ?? "?"} (${exportado.sistema} ${exportado.versao ?? ""})`);
for (const [nome, novas] of Object.entries(porCompendio)) {
  const atuais = substituir ? [] : lerCompendio(nome);
  const ids = new Set(atuais.map(e => e.id).filter(Boolean));
  const entram = novas.filter(e => !ids.has(e.id));
  if (substituir) escreverYaml(nome, entram);
  else escreverYaml(nome, entram, { acrescentar: true });

  const avisos = [];
  // Mesmo nome na mesma pasta costuma ser cópia esquecida no mundo.
  const vistos = new Map();
  for (const e of [...atuais, ...entram]) {
    const chave = `${e.pasta ?? ""}/${e.nome}`;
    if (vistos.has(chave)) avisos.push(`nome repetido na mesma pasta: ${chave}`);
    vistos.set(chave, true);
  }
  console.log(`${nome}: ${entram.length} novos, ${novas.length - entram.length} já estavam, ${atuais.length + entram.length} no arquivo`);
  for (const aviso of avisos) console.log(`  ${aviso}`);
}
for (const [tipo, n] of Object.entries(ignorados)) {
  console.log(`ignorados: ${n} do tipo ${tipo}, que não tem compêndio aqui`);
}
