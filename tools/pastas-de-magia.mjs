/**
 * Em que pasta do compêndio de magias cada magia entra: a do elemento dela,
 * ou a da combinação quando ela mistura elementos (Fogo + Vento = Calor).
 *
 * O elemento de cada runa da magia sai do compêndio de runas, pelo nome ou
 * pela palavra. Runa que não está lá (a palavra de um personagem, como
 * "Sopro") diz o elemento na própria referência, com `elemento: vento`, ou
 * `elemento: gesto` quando é forma ou modificador.
 */
import fs from "node:fs";
import path from "node:path";
import { PASTA_FONTE } from "./compendios.mjs";

/** Os elementos na ordem das pastas, com o nome que a pasta mostra. */
export const ELEMENTOS = {
  agua: "Água", fogo: "Fogo", vento: "Vento", raio: "Raio", terra: "Terra",
  gelo: "Gelo", vida: "Vida", mente: "Mente", morte: "Morte", espaco: "Espaço"
};

/** O que uma referência pode dizer em `elemento`. */
export const VALORES_DE_ELEMENTO = [...Object.keys(ELEMENTOS), "gesto"];

/*
 * Combinações com nome. A chave são os elementos na ordem de ELEMENTOS.
 * Combinação sem nome ainda vira os nomes juntos ("Água/Fogo/Raio"), e é só
 * acrescentar a linha aqui quando ela ganhar um.
 */
const COMBINACOES = [
  [["agua", "fogo"], "Vapor"],
  [["agua", "vento"], "Gelo"],
  [["agua", "raio"], "Tempestade"],
  [["agua", "terra"], "Madeira"],
  [["fogo", "vento"], "Calor"],
  [["fogo", "raio"], "Plasma"],
  [["fogo", "terra"], "Magma"],
  [["vento", "raio"], "Vendaval"],
  [["vento", "terra"], "Magnetismo"],
  [["raio", "terra"], "Explosão"],
  [["agua", "fogo", "vento"], "Arco-Íris"],
  [["agua", "fogo", "raio"], null],
  [["agua", "fogo", "terra"], null],
  [["agua", "vento", "raio"], null],
  [["agua", "vento", "terra"], "Ácido"],
  [["agua", "raio", "terra"], null],
  [["fogo", "vento", "raio"], null],
  [["fogo", "vento", "terra"], "Poeira"],
  [["fogo", "raio", "terra"], null],
  [["vento", "raio", "terra"], null],
  [["vida", "mente", "morte"], "Yin Yang"]
];

const ORDEM = Object.keys(ELEMENTOS);
const emOrdem = lista => [...new Set(lista)].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b));
const chave = lista => emOrdem(lista).join("+");
const juntos = lista => emOrdem(lista).map(e => ELEMENTOS[e]).join("/");
const COMBINACAO = new Map(COMBINACOES.map(([lista, nome]) => [chave(lista), nome ?? juntos(lista)]));

/** Gelo já é Água + Vento: misturado com outro elemento, conta como os dois. */
function expandir(elementos) {
  const lista = emOrdem(elementos);
  if (lista.length < 2 || !lista.includes("gelo")) return lista;
  return emOrdem(lista.flatMap(e => (e === "gelo" ? ["agua", "vento"] : [e])));
}

export const PASTA_SEM_ELEMENTO = "Sem elemento";

/** A pasta de uma magia pelos elementos das runas dela. */
export function pastaDaMagia(elementos) {
  const lista = expandir(elementos);
  if (!lista.length) return PASTA_SEM_ELEMENTO;
  if (lista.length === 1) return ELEMENTOS[lista[0]];
  return COMBINACAO.get(chave(lista)) ?? juntos(lista);
}

/**
 * Posição da pasta na lista: os elementos sozinhos, depois as combinações na
 * ordem da tabela, depois as que ainda não estão nela e por fim a pasta sem
 * elemento.
 */
export function ordemDaPasta(nome) {
  const sozinho = Object.values(ELEMENTOS).indexOf(nome);
  if (sozinho >= 0) return sozinho;
  const combinada = [...new Set(COMBINACAO.values())].indexOf(nome);
  if (combinada >= 0) return 100 + combinada;
  return nome === PASTA_SEM_ELEMENTO ? 10000 : 1000;
}

/**
 * Nome ou palavra de cada runa do compêndio de runas → o elemento dela, ou
 * "gesto". Lido da origem que o gerar-runas.mjs acabou de escrever.
 */
export function elementosDoCompendioDeRunas() {
  const pasta = path.join(PASTA_FONTE, "runas");
  const mapa = new Map();
  if (!fs.existsSync(pasta)) return mapa;
  for (const arquivo of fs.readdirSync(pasta).filter(f => f.endsWith(".json"))) {
    const doc = JSON.parse(fs.readFileSync(path.join(pasta, arquivo), "utf8"));
    if (doc.type !== "runa") continue;
    const valor = doc.system?.tipoRuna === "elemento" ? doc.system.subtipo : "gesto";
    for (const nome of [doc.name, doc.system?.palavra]) {
      if (nome) mapa.set(normalizar(nome), valor);
    }
  }
  return mapa;
}

export const normalizar = texto => String(texto ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").trim().toLowerCase();
