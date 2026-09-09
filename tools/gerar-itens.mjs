/**
 * Gera os documentos de origem do compêndio de itens a partir de tools/itens.md.
 *
 * O markdown é a fonte da verdade: você edita as tabelas lá, roda este script e
 * depois o compilar-packs.mjs. O que sai daqui é um JSON por item em
 * packs/_source/itens/, no formato que o empacotador do Foundry espera.
 *
 * O que o script NÃO faz é inventar mecânica. Texto de efeito que não cabe em
 * nenhum campo do sistema continua inteiro na descrição do item, e no fim da
 * execução sai um relatório do que ficou só como texto — para essa lista virar
 * a fila do que ainda falta modelar, em vez de sumir em silêncio.
 *
 *   node tools/gerar-itens.mjs
 */
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "tools", "itens.md");
const SAIDA = path.join(RAIZ, "packs", "_source", "itens");

/* -------------------------------------------------------------------------- */
/*  Tabelas de tradução                                                       */
/* -------------------------------------------------------------------------- */

/** Ordem das pastas de categoria, igual à do inventário da ficha. */
const CATEGORIAS = [
  { chave: "equipamento", titulo: "Equipamentos",  pasta: "Equipamentos" },
  { chave: "arma",        titulo: "Armas",         pasta: "Armas" },
  { chave: "municao",     titulo: "Munições",      pasta: "Munições" },
  { chave: "artefato",    titulo: "Artefatos",     pasta: "Artefatos" },
  { chave: "arcano",      titulo: "Itens Arcanos", pasta: "Itens Arcanos" },
  { chave: "mochila",     titulo: "Mochilas",      pasta: "Mochilas" },
  { chave: "consumivel",  titulo: "Consumíveis",   pasta: "Consumíveis" }
];

/** Raridades canônicas, da mais comum para a mais rara. */
const RARIDADES = [
  { chave: "bruto",    pasta: "Bruto" },
  { chave: "comum",    pasta: "Comum" },
  { chave: "incomum",  pasta: "Incomum" },
  { chave: "raro",     pasta: "Raro" },
  { chave: "lendario", pasta: "Lendário" },
  { chave: "mitico",   pasta: "Mítico" }
];

/** Aceita singular, plural e as duas flexões de gênero dos títulos. */
const RARIDADE_POR_TEXTO = {
  bruto: "bruto", brutos: "bruto", bruta: "bruto", brutas: "bruto",
  comum: "comum", comuns: "comum",
  incomum: "incomum", incomuns: "incomum",
  raro: "raro", raros: "raro", rara: "raro", raras: "raro",
  lendario: "lendario", lendarios: "lendario", lendaria: "lendario",
  mitico: "mitico", miticos: "mitico", mitica: "mitico"
};

const PARTES = {
  cabeca: "cabeca", peitoral: "peitoral", costas: "costas", cintura: "cintura",
  pescoco: "pescoco", anel: "aneis", aneis: "aneis", aneis2: "aneis",
  mao: "maos", maos: "maos", pes: "pes", pe: "pes",
  // Escudo é empunhado: o sistema já trata escudo como equipamento de mão.
  escudo: "maos"
};

const TIPOS_DANO = {
  cortante: "cortante", impacto: "impacto", perfurante: "perfurante",
  energia: "energia", calor: "calor", frio: "frio", mental: "mental"
};

const ATRIBUTOS = {
  forca: "for", vigor: "vig", destreza: "des", agilidade: "agi",
  intelecto: "int", sabedoria: "sab", presenca: "pre"
};

/*
 * Ícones do conjunto do sistema (ver tools/gerar-icones.mjs). Caminho absoluto
 * com o id do system.json: o Foundry resolve imagem a partir da raiz de dados,
 * e a cópia de desenvolvimento tem id próprio.
 */
const SISTEMA = JSON.parse(
  readFileSync(new URL("../system.json", import.meta.url), "utf8")
).id;
const icone = nome => `systems/${SISTEMA}/icons/${nome}.svg`;

const ICONES = {
  arma: icone("arma"),
  // Arma de alcance leva a lança arremessada, a mesma marca da forma Projétil.
  armaDistancia: icone("projetil"),
  equipamento: icone("equipamento"),
  municao: icone("projetil"),
  // Artefato e item arcano são mágicos: levam a marca da magia.
  artefato: icone("magia"),
  arcano: icone("magia"),
  // Mochila continua na sacola do próprio Foundry: não há marca nossa para ela.
  mochila: "icons/svg/item-bag.svg",
  consumivel: icone("consumivel")
};

/* -------------------------------------------------------------------------- */
/*  Utilidades                                                                */
/* -------------------------------------------------------------------------- */

const semAcento = t => String(t ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Id de 16 caracteres, estável para o mesmo nome: regerar não troca ids. */
function idEstavel(...partes) {
  const hash = crypto.createHash("sha1").update(partes.join("|")).digest("hex");
  // base36 dá letras e números; o Foundry exige exatamente 16 alfanuméricos.
  return BigInt(`0x${hash}`).toString(36).padStart(16, "0").slice(0, 16);
}

const numero = t => {
  const n = Number(String(t ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Markdown simples da célula vira HTML de parágrafo. */
function paragrafos(...textos) {
  return textos
    .map(t => String(t ?? "").trim())
    .filter(t => t && t !== "—" && t !== "-")
    .map(t => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"))
    .map(t => `<p>${t}</p>`)
    .join("");
}

/** Linhas de dados de uma tabela markdown, já sem cabeçalho e separador. */
function lerTabela(linhas) {
  const celulas = l => l.split("|").slice(1, -1).map(c => c.trim());
  const cabecalho = celulas(linhas[0]);
  const dados = linhas.slice(2)
    .filter(l => l.trim().startsWith("|"))
    .map(celulas)
    .filter(c => c.some(v => v && v !== "—" && v !== "-"));
  return { cabecalho, dados };
}

/* -------------------------------------------------------------------------- */
/*  Leitura do markdown                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Quebra o arquivo em blocos { categoria, raridade, tabela }. A raridade vem
 * do subtítulo quando existe; nas tabelas que têm coluna de Raridade, ela vem
 * de cada linha e o subtítulo é ignorado.
 */
function lerBlocos(texto) {
  const blocos = [];
  let categoria = null;
  let raridade = null;
  let buffer = [];

  const fechar = () => {
    if (buffer.length >= 2 && categoria) {
      blocos.push({ categoria, raridade, ...lerTabela(buffer) });
    }
    buffer = [];
  };

  for (const linha of texto.split(/\r?\n/)) {
    if (linha.startsWith("## ")) {
      fechar();
      const titulo = semAcento(linha.slice(3));
      categoria = CATEGORIAS.find(c => semAcento(c.titulo) === titulo) ?? null;
      raridade = null;
      continue;
    }
    if (linha.startsWith("### ")) {
      fechar();
      raridade = RARIDADE_POR_TEXTO[semAcento(linha.slice(4))] ?? null;
      continue;
    }
    if (linha.trim().startsWith("|")) buffer.push(linha);
    else fechar();
  }
  fechar();
  return blocos;
}

/* -------------------------------------------------------------------------- */
/*  Conversores por categoria                                                 */
/* -------------------------------------------------------------------------- */

const naoMapeado = [];
const anotar = (nome, texto) => { if (texto) naoMapeado.push({ nome, texto }); };

/** Coluna da tabela pelo nome do cabeçalho, tolerante a acento e caixa. */
function coluna(cabecalho, ...nomes) {
  const alvos = nomes.map(semAcento);
  return cabecalho.findIndex(c => alvos.includes(semAcento(c)));
}

/**
 * Lê defesas, bloqueio e esquiva de um texto de efeito.
 *
 * Cuidado com duas formas parecidas: "Defesa Energética" é a categoria
 * inteira (calor, frio e energia), enquanto "Defesa de Energia" é só o tipo
 * energia. Trocar uma pela outra muda bastante a conta de dano.
 */
function lerEfeitoDefensivo(texto) {
  const saida = {
    categorias: { fisico: 0, energetico: 0, mental: 0 },
    tipos: {}, bloqueio: "", esquiva: "", sobrou: []
  };
  if (!texto) return saida;

  for (const trecho of texto.split(/[.;]\s*/)) {
    const t = trecho.trim();
    if (!t) continue;
    let casou = false;

    const bloq = t.match(/\+\s*(\d+d\d+)\s*de\s*bloqueio/i);
    if (bloq) { saida.bloqueio = bloq[1]; casou = true; }
    const esq = t.match(/\+\s*(\d+d\d+)\s*de\s*esquiva/i);
    if (esq) { saida.esquiva = esq[1]; casou = true; }

    // Categoria: "Defesa Física", "Defesa Energética", "Defesa Mental".
    for (const [rotulo, chave] of [["fisica", "fisico"], ["energetica", "energetico"], ["mental", "mental"]]) {
      const re = new RegExp(`\\+\\s*(\\d+)\\s*defesa\\s+${rotulo}`, "i");
      const m = semAcento(t).match(re);
      if (m) { saida.categorias[chave] += Number(m[1]); casou = true; }
    }
    // Tipo: "Defesa de Energia", "Defesa de Calor"...
    const tipo = semAcento(t).match(/\+\s*(\d+)\s*defesa\s+de\s+(\w+)/i);
    if (tipo && TIPOS_DANO[tipo[2]]) {
      const chave = TIPOS_DANO[tipo[2]];
      saida.tipos[chave] = (saida.tipos[chave] ?? 0) + Number(tipo[1]);
      casou = true;
    }

    if (!casou) saida.sobrou.push(t);
  }
  return saida;
}

/** Efeitos ativos gerados a partir do texto ("o vigor do usuário aumenta em 4"). */
function efeitosDoTexto(nome, texto, idBase) {
  const efeitos = [];
  const re = /o\s+(\w+)\s+do\s+usu[aá]rio\s+aumenta\s+em\s+(\d+)/gi;
  for (const m of String(texto ?? "").matchAll(re)) {
    const attr = ATRIBUTOS[semAcento(m[1])];
    if (!attr) continue;
    const idEfeito = idEstavel(idBase, "efeito", attr);
    efeitos.push({
      _id: idEfeito,
      // Documento embutido também tem chave própria no pack, no formato
      // "!<coleção>.<subcoleção>!<id do dono>.<id dele>".
      _key: `!items.effects!${idBase}.${idEfeito}`,
      name: nome,
      img: "icons/svg/upgrade.svg",
      // v14: mudanças em system.changes, com o tipo em texto.
      system: {
        changes: [{ key: `system.atributos.${attr}.bonus`, type: "add", value: m[2], priority: 20 }]
      },
      disabled: false,
      transfer: true
    });
  }
  return efeitos;
}

function converterEquipamento(cab, linha, categoria, raridade) {
  const nome = linha[coluna(cab, "Equipamento", "Peça", "Item")];
  const parteTexto = linha[coluna(cab, "Parte do Corpo")];
  const efeitoTexto = linha[coluna(cab, "Efeito", "Efeito individual")] ?? "";
  const notas = linha[coluna(cab, "Notas")] ?? "";
  const def = lerEfeitoDefensivo(efeitoTexto);
  const id = idEstavel(categoria.chave, nome);

  const system = {
    descricao: paragrafos(efeitoTexto, notas),
    categoria: categoria.chave === "equipamento" ? "equipamento" : categoria.chave,
    parte: PARTES[semAcento(parteTexto)] ?? "peitoral",
    equipado: false,
    defesas: { categorias: def.categorias, tipos: def.tipos },
    bloqueio: def.bloqueio,
    esquiva: def.esquiva,
    peso: numero(linha[coluna(cab, "Peso")]),
    custo: numero(linha[coluna(cab, "Custo")]),
    quantidade: 1,
    cargaBonus: 0,
    reducaoMana: 0
  };

  // Mochila: "aumenta a capacidade de carga do usuário em 18".
  const carga = efeitoTexto.match(/capacidade de carga.*?em\s+(\d+)/i);
  if (carga) system.cargaBonus = Number(carga[1]);

  /*
   * Item arcano: só o desconto incondicional vira campo. A peça de conjunto
   * diz "caso as N peças estejam equipadas", e o sistema ainda não sabe olhar
   * conjunto — dar o desconto a ela sozinha seria mentir na ficha.
   */
  const mana = efeitoTexto.match(/custam\s+(\d+)\s+de\s+mana\s+a\s+menos/i);
  if (mana && !/conjunto|caso as/i.test(efeitoTexto)) system.reducaoMana = Number(mana[1]);

  const sobrou = def.sobrou.filter(t => !/capacidade de carga|de mana a menos/i.test(t));
  anotar(nome, sobrou.join(" · "));

  const icone = categoria.chave === "equipamento"
    ? ICONES.equipamento : ICONES[categoria.chave];
  return {
    doc: { _id: id, name: nome, type: "equipamento", img: icone, system },
    efeitos: efeitosDoTexto(nome, efeitoTexto, id),
    raridade
  };
}

function converterArma(cab, linha, raridade) {
  const nome = linha[coluna(cab, "Arma")];
  const notas = linha[coluna(cab, "Notas")] ?? "";
  // "2d8 + DES" vira "2d8 + [DES]", que é a sintaxe que o sistema expande.
  const dano = String(linha[coluna(cab, "Dano")] ?? "")
    .replace(/\b(FOR|VIG|DES|AGI|INT|SAB|PRE)\b/g, "[$1]");
  const alcance = String(linha[coluna(cab, "Alcance")] ?? "0m").match(/\d+/g)?.map(Number) ?? [0];

  const system = {
    descricao: paragrafos(notas),
    danos: [{ formula: dano, tipo: TIPOS_DANO[semAcento(linha[coluna(cab, "Tipo")])] ?? "impacto" }],
    // Só as armas que gastam projétil do inventário; a que fabrica a própria
    // munição fica de fora de propósito.
    usaMunicao: /consome\s+\d+\s+(flecha|virote)/i.test(notas),
    acoes: numero(linha[coluna(cab, "Ações")]),
    maos: numero(linha[coluna(cab, "Mãos")]) || 1,
    alcanceMenor: alcance[0] ?? 0,
    // Sem segundo número o alcance máximo é 0: é arma de corpo a corpo, e o
    // primeiro número é o alcance dela.
    alcanceMaximo: alcance[1] ?? 0,
    peso: numero(linha[coluna(cab, "Peso")]),
    custo: numero(linha[coluna(cab, "Custo")]),
    quantidade: 1
  };

  // Recarga, munição própria e conversões para magia continuam só no texto.
  if (notas && !/^consome \d+ (flecha|virote)\.?$/i.test(notas.trim())) anotar(nome, notas);

  const id = idEstavel("arma", nome);
  return {
    doc: {
      _id: id, name: nome, type: "arma",
      img: system.alcanceMaximo >= 3 ? ICONES.armaDistancia : ICONES.arma,
      system
    },
    efeitos: [],
    raridade
  };
}

function converterMunicao(cab, linha) {
  const nome = linha[coluna(cab, "Item")];
  const efeito = linha[coluna(cab, "Efeito")] ?? "";
  const extra = efeito.match(/\+?\s*\*{0,2}(\d+d\d+)\s+de\s+(\w+)/i);

  const system = {
    descricao: paragrafos(efeito),
    acoes: 0,
    formula: extra ? extra[1] : "",
    municao: true,
    tipoDano: extra ? (TIPOS_DANO[semAcento(extra[2])] ?? "perfurante") : "perfurante",
    equipado: false,
    parte: "cintura",
    peso: numero(linha[coluna(cab, "Peso")]),
    custo: numero(linha[coluna(cab, "Custo")]),
    quantidade: 1
  };

  return {
    doc: { _id: idEstavel("municao", nome), name: nome, type: "consumivel", img: ICONES.municao, system },
    efeitos: [],
    raridade: RARIDADE_POR_TEXTO[semAcento(linha[coluna(cab, "Raridade")])] ?? "bruto"
  };
}

function converterConsumivel(cab, linha) {
  const nome = linha[coluna(cab, "Item")];
  const efeito = linha[coluna(cab, "Efeito")] ?? "";
  const acoesTexto = String(linha[coluna(cab, "Ações para uso", "Ações para ativação")] ?? "");
  // "1 hora" não é custo de ação: vira 0 e o texto explica na descrição.
  const acoes = /hora|minuto/i.test(acoesTexto) ? 0 : numero(acoesTexto);

  // Só a recuperação clara vira fórmula; dano de duas naturezas e efeitos
  // narrativos ficam no texto, senão a ficha rolaria a coisa errada.
  const cura = efeito.match(/recupera\s+\*{0,2}([\dd\s+]+?)(?:\s*\+\s*(VIG|FOR|DES|AGI|INT|SAB|PRE))?\s*(?:de\s+)?(?:PV|Estamina)/i);
  let formula = "";
  if (cura) {
    formula = cura[1].trim().replace(/\s*\+\s*$/, "");
    if (cura[2]) formula += ` + [${cura[2]}]`;
  } else anotar(nome, efeito);
  if (/hora|minuto/i.test(acoesTexto)) anotar(nome, `Tempo de uso: ${acoesTexto}`);

  const system = {
    descricao: paragrafos(efeito),
    acoes,
    formula,
    municao: false,
    tipoDano: "perfurante",
    equipado: false,
    parte: "cintura",
    peso: numero(linha[coluna(cab, "Peso")]),
    custo: numero(linha[coluna(cab, "Custo")]),
    quantidade: 1
  };

  return {
    doc: { _id: idEstavel("consumivel", nome), name: nome, type: "consumivel", img: ICONES.consumivel, system },
    efeitos: [],
    raridade: RARIDADE_POR_TEXTO[semAcento(linha[coluna(cab, "Raridade")])] ?? "bruto"
  };
}

/* -------------------------------------------------------------------------- */
/*  Montagem                                                                  */
/* -------------------------------------------------------------------------- */

function converter(bloco) {
  const { cabecalho: cab, dados, categoria, raridade } = bloco;
  return dados.map(linha => {
    switch (categoria.chave) {
      case "arma": return converterArma(cab, linha, raridade);
      case "municao": return converterMunicao(cab, linha);
      case "consumivel": return converterConsumivel(cab, linha);
      default: {
        const item = converterEquipamento(cab, linha, categoria, raridade);
        // Mochila e consumível trazem a raridade em coluna, não em subtítulo.
        const daColuna = coluna(cab, "Raridade");
        if (daColuna >= 0) {
          item.raridade = RARIDADE_POR_TEXTO[semAcento(linha[daColuna])] ?? "bruto";
        }
        return item;
      }
    }
  });
}

function main() {
  const blocos = lerBlocos(fs.readFileSync(ENTRADA, "utf8"));
  const itens = blocos.flatMap(converter).filter(i => i.doc.name);

  fs.rmSync(SAIDA, { recursive: true, force: true });
  fs.mkdirSync(SAIDA, { recursive: true });

  const arquivos = [];
  const escrever = (nomeArquivo, doc) => {
    arquivos.push(nomeArquivo);
    fs.writeFileSync(path.join(SAIDA, nomeArquivo),
      JSON.stringify(doc, null, 2) + "\n", "utf8");
  };

  /* --- Pastas: categoria e, dentro dela, as raridades que têm item -------- */
  const usadas = new Map();
  for (const item of itens) {
    const cat = CATEGORIAS.find(c => c.chave === chaveDaCategoria(item));
    if (!usadas.has(cat.chave)) usadas.set(cat.chave, new Set());
    usadas.get(cat.chave).add(item.raridade ?? "bruto");
  }

  const idPasta = {};
  CATEGORIAS.forEach((cat, i) => {
    const id = idEstavel("pasta", cat.chave);
    idPasta[cat.chave] = id;
    escrever(`_pasta-${cat.chave}.json`, {
      _id: id, _key: `!folders!${id}`, name: cat.pasta, type: "Item",
      folder: null, sorting: "m", sort: (i + 1) * 100000, color: null
    });
    // Raridade sem item nenhum não vira pasta: ela aparece sozinha quando o
    // primeiro item daquele degrau for escrito no markdown.
    RARIDADES.filter(r => usadas.get(cat.chave)?.has(r.chave)).forEach((r, j) => {
      const sub = idEstavel("pasta", cat.chave, r.chave);
      idPasta[`${cat.chave}/${r.chave}`] = sub;
      escrever(`_pasta-${cat.chave}-${r.chave}.json`, {
        _id: sub, _key: `!folders!${sub}`, name: r.pasta, type: "Item",
        folder: id, sorting: "m", sort: (j + 1) * 100000, color: null
      });
    });
  });

  /* --- Itens -------------------------------------------------------------- */
  for (const item of itens) {
    const cat = chaveDaCategoria(item);
    const doc = {
      ...item.doc,
      _key: `!items!${item.doc._id}`,
      folder: idPasta[`${cat}/${item.raridade ?? "bruto"}`] ?? idPasta[cat],
      effects: item.efeitos,
      flags: {},
      ownership: { default: 0 }
    };
    const slug = semAcento(item.doc.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    escrever(`${cat}-${slug}.json`, doc);
  }

  /* --- Relatório ---------------------------------------------------------- */
  const porCategoria = {};
  for (const item of itens) {
    const c = chaveDaCategoria(item);
    porCategoria[c] = (porCategoria[c] ?? 0) + 1;
  }
  console.log(`${itens.length} itens em ${arquivos.length} arquivos:`);
  for (const cat of CATEGORIAS) {
    console.log(`  ${String(porCategoria[cat.chave] ?? 0).padStart(3)}  ${cat.pasta}`);
  }
  const ids = new Set(itens.map(i => i.doc._id));
  if (ids.size !== itens.length) throw new Error("Dois itens receberam o mesmo id.");

  if (naoMapeado.length) {
    console.log(`\n${naoMapeado.length} efeito(s) ficaram só como texto na descrição:`);
    for (const { nome, texto } of naoMapeado) console.log(`  ${nome}: ${texto}`);
  }
}

/** Categoria de um item já convertido, deduzida do tipo e da classificação. */
function chaveDaCategoria(item) {
  const { type, system } = item.doc;
  if (type === "arma") return "arma";
  if (type === "consumivel") return system.municao ? "municao" : "consumivel";
  return system.categoria ?? "equipamento";
}

main();
