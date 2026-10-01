/**
 * Gera os documentos de origem dos compêndios de poderes (caminhos,
 * habilidades, técnicas, feitiços, magias e perícias) a partir dos arquivos
 * de tools/compendios/. O formato de cada arquivo está no cabeçalho dele.
 *
 * Confere antes de escrever: chave desconhecida numa entrada, id repetido ou
 * fora do formato param o build com a linha do problema, em vez de virarem
 * um item quebrado no compêndio.
 *
 *   node tools/gerar-compendios.mjs && node tools/compilar-packs.mjs
 */
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import {
  PASTA_FONTE, COMPENDIOS, CAMPOS_DA_ENTRADA, idEstavel, idValido, lerCompendio
} from "./compendios.mjs";

/*
 * Os arquivos escrevem "pyro" no lugar do id do sistema, nas imagens e nas
 * flags, e o build põe o id do system.json: a cópia de desenvolvimento
 * ("pyro-dev") e a da mesa leem cada uma as suas.
 */
const SISTEMA = JSON.parse(readFileSync(new URL("../system.json", import.meta.url), "utf8")).id;
const ESCOPO = "pyro";
const imagemDoSistema = img => (typeof img === "string"
  ? img.replace(`systems/${ESCOPO}/`, `systems/${SISTEMA}/`) : img);
function flagsDoSistema(flags) {
  if (!flags || typeof flags !== "object") return {};
  if (SISTEMA === ESCOPO || !(ESCOPO in flags)) return flags;
  const { [ESCOPO]: nossas, ...resto } = flags;
  return { ...resto, [SISTEMA]: nossas };
}

const erros = [];

/** "Elfo / Formas/" vira ["Elfo", "Formas"]. */
const partesDaPasta = pasta => String(pasta ?? "").split("/").map(p => p.trim()).filter(Boolean);

const slug = texto => texto.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function gerar(nome) {
  const { tipo } = COMPENDIOS[nome];
  let entradas;
  try {
    entradas = lerCompendio(nome);
  } catch (erro) {
    erros.push(`${nome}.yml: YAML inválido. ${erro.message}`);
    return 0;
  }
  if (!Array.isArray(entradas)) {
    erros.push(`${nome}.yml: o arquivo tem que ser uma lista (cada item começa com "- nome:")`);
    return 0;
  }

  const saida = path.join(PASTA_FONTE, nome);
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });
  const escrever = (arquivoJson, doc) =>
    fs.writeFileSync(path.join(saida, arquivoJson), `${JSON.stringify(doc, null, 2)}\n`);

  /* --- Pastas, na ordem em que aparecem no arquivo ----------------------- */
  const pastas = new Map();
  function idDaPasta(partes) {
    if (!partes.length) return null;
    const caminho = partes.join("/");
    if (pastas.has(caminho)) return pastas.get(caminho)._id;
    const pai = idDaPasta(partes.slice(0, -1));
    const id = idEstavel("pasta", nome, caminho);
    pastas.set(caminho, {
      _id: id, _key: `!folders!${id}`, name: partes.at(-1), type: "Item",
      folder: pai, sorting: "m", sort: (pastas.size + 1) * 100000, color: null
    });
    return id;
  }

  /* --- Itens ------------------------------------------------------------- */
  const ids = new Set();
  const nomesDeArquivo = new Set();
  entradas.forEach((entrada, indice) => {
    const onde = `${nome}.yml, item ${indice + 1}${entrada?.nome ? ` (${entrada.nome})` : ""}`;
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
      erros.push(`${onde}: cada item tem que ser um bloco com nome, system...`);
      return;
    }
    const estranhas = Object.keys(entrada).filter(k => !CAMPOS_DA_ENTRADA.includes(k));
    if (estranhas.length) erros.push(`${onde}: campo desconhecido ${estranhas.join(", ")}`);
    if (!entrada.nome) {
      erros.push(`${onde}: falta o nome`);
      return;
    }

    const partes = partesDaPasta(entrada.pasta);
    const id = entrada.id ?? idEstavel(nome, partes.join("/"), entrada.nome);
    if (!idValido(id)) erros.push(`${onde}: id "${id}" precisa ter 16 letras ou números`);
    if (ids.has(id)) erros.push(`${onde}: id ${id} repetido`);
    ids.add(id);

    const efeitos = (entrada.efeitos ?? []).map((efeito, i) => {
      const { id: idEfeito, ...resto } = efeito ?? {};
      const _id = idEfeito ?? idEstavel(id, "efeito", i, resto.name ?? "");
      if (!resto.name) erros.push(`${onde}: o efeito ${i + 1} está sem name`);
      if (!idValido(_id)) erros.push(`${onde}: id do efeito ${i + 1} precisa ter 16 letras ou números`);
      return {
        _id, _key: `!items.effects!${id}.${_id}`, ...resto,
        ...("img" in resto ? { img: imagemDoSistema(resto.img) } : {}),
        flags: flagsDoSistema(resto.flags)
      };
    });

    // Nome de arquivo legível e único, para o diff de packs/_source ser lido.
    let base = [slug(partes.join(" ")), slug(entrada.nome)].filter(Boolean).join("-") || id;
    if (nomesDeArquivo.has(base)) base = `${base}-${id}`;
    nomesDeArquivo.add(base);

    escrever(`${base}.json`, {
      _id: id,
      _key: `!items!${id}`,
      name: String(entrada.nome),
      type: tipo,
      // Sem imagem, o ícone do tipo, o mesmo que a ficha dá a um item novo.
      img: imagemDoSistema(entrada.img ?? `systems/${ESCOPO}/icons/${tipo}.svg`),
      folder: idDaPasta(partes),
      sort: (indice + 1) * 100000,
      system: entrada.system ?? {},
      effects: efeitos,
      flags: flagsDoSistema(entrada.flags),
      ownership: { default: 0 }
    });
  });

  for (const pasta of pastas.values()) escrever(`_pasta-${slug(pasta.name)}-${pasta._id}.json`, pasta);
  return entradas.length;
}

for (const nome of Object.keys(COMPENDIOS)) {
  const total = gerar(nome);
  console.log(`${nome}: ${total} itens`);
}

if (erros.length) {
  console.error("\nO build parou. Corrija nos arquivos de tools/compendios/:");
  for (const erro of erros) console.error(`  ${erro}`);
  process.exit(1);
}
