/**
 * Gera os documentos de origem do compêndio de runas em packs/_source/runas/.
 *
 * As runas do SRD (nove elementos mais o gelo, as sete formas e os cinco
 * gestos modificadores) vivem aqui, não no código: é o compêndio que carrega
 * os números de cada uma. O sistema reconhece três gestos pelo NOME — Toque
 * empresta Intenção, Longo sobe passos de alcance e Dividir reparte o dano;
 * os outros valem só pelos escalonamentos, então um gesto novo é uma runa
 * nova aqui, sem tocar no código.
 *
 *   node tools/gerar-runas.mjs && node tools/compilar-packs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const RAIZ = path.resolve(import.meta.dirname, "..");
const SAIDA = path.join(RAIZ, "packs", "_source", "runas");

/** Ícones do conjunto svg do núcleo, que existe em qualquer instalação. */
const ICONES = {
  fogo: "icons/svg/fire.svg", agua: "icons/svg/aura.svg", gelo: "icons/svg/frozen.svg",
  vento: "icons/svg/direction.svg", terra: "icons/svg/shield.svg", raio: "icons/svg/lightning.svg",
  vida: "icons/svg/heal.svg", mente: "icons/svg/eye.svg", morte: "icons/svg/skull.svg",
  espaco: "icons/svg/circle.svg",
  projetil: "icons/svg/target.svg", explosao: "icons/svg/explosion.svg", cone: "icons/svg/light.svg",
  linha: "icons/svg/direction.svg", muro: "icons/svg/shield.svg", aura: "icons/svg/aura.svg",
  toque: "icons/svg/upgrade.svg",
  amplo: "icons/svg/net.svg", longo: "icons/svg/target.svg", persistente: "icons/svg/aura.svg",
  preciso: "icons/svg/eye.svg", dividir: "icons/svg/combat.svg"
};

const escala = (nome, base, porIntencao, faces = 0) => ({ nome, base, porIntencao, faces });

/**
 * Elementos: o dado de dano e o que mais escala junto. Os números são os
 * mesmos da tabela de PYRO.elementosPadrao, que o mestre pode reajustar nas
 * configurações do mundo — aqui eles são o retrato de origem da runa.
 */
const ELEMENTOS = [
  { chave: "fogo", nome: "Fogo", dano: [3, 3, 6],
    desc: "Para cada 6 rolado, aumente em 1 o Queimando do alvo. Se a duração de Queimando for menor que 2, ela se torna 2." },
  { chave: "agua", nome: "Água", dano: [4, 4, 4],
    desc: "Adiciona 1 dado ao próximo dano de Frio que o alvo receber, para cada 1 de Intenção." },
  { chave: "gelo", nome: "Gelo", dano: [4, 2, 8],
    desc: "O alvo sofre Friagem por 1 rodada: cada reação custa Intenção² de estamina a mais. Teste de VIG para resistir." },
  { chave: "vento", nome: "Vento", dano: [4, 4, 4],
    desc: "Empurra o alvo 1m por Intenção. Contra uma parede, causa 1d10 adicional para cada metro que restar." },
  { chave: "terra", nome: "Terra", dano: [3, 2, 12],
    desc: "Quem conjura recebe Defesa Física adicional igual à Intenção até o fim do próximo turno." },
  { chave: "raio", nome: "Raio", dano: [2, 0.5, 10], extras: [escala("Corrente", 0.5, 0.5)],
    desc: "A partir da Intenção 2 a corrente pula para alvos próximos, Intenção metros de um para outro, sem atingir o mesmo alvo duas vezes seguidas." },
  { chave: "vida", nome: "Vida", dano: [2, 2, 8], desc: "Cura em vez de causar dano." },
  { chave: "mente", nome: "Mente", dano: [1, 1, 6],
    desc: "A cada Intenção acima de 1, aplique uma condição mental ou aumente em 1 rodada a duração de uma já escolhida. O alvo testa SAB contra a DT para resistir a cada condição nova." },
  { chave: "morte", nome: "Morte", dano: [2, 2, 12], subjulgar: true,
    desc: "Não causa dano direto: o resultado é comparado com a vida máxima do alvo (ver Subjulgar)." },
  { chave: "espaco", nome: "Espaço", dano: null,
    desc: "Portais, teleporte e dimensões de bolso. Sem dano padrão: o efeito é combinado com o mestre." }
];

/** Formas: a Intenção define alcance, área e número de alvos. */
const FORMAS = [
  { chave: "projetil", nome: "Projétil", scalings: [escala("Alcance", 6, 4)],
    desc: "1 alvo a 6 metros, +4 metros por Intenção." },
  { chave: "explosao", nome: "Explosão", scalings: [escala("Raio", 1, 1), escala("Alcance", 6, 0)],
    desc: "Raio de 1 metro centrado a até 6 metros, +1 de raio por Intenção." },
  { chave: "cone", nome: "Cone", scalings: [escala("Alcance", 3, 2)],
    desc: "Cone de 3 metros à frente, +2 metros por Intenção." },
  { chave: "linha", nome: "Linha", scalings: [escala("Comprimento", 6, 4)],
    desc: "Linha de 6 metros de comprimento, +4 por Intenção." },
  { chave: "muro", nome: "Muro", scalings: [escala("Extensão", 3, 2), escala("PV do muro", 5, 5)],
    desc: "Muro de 3 metros de extensão com PV igual a 5 × Intenção, +2 de extensão por Intenção." },
  { chave: "aura", nome: "Aura", scalings: [escala("Raio", 1, 1), escala("Rodadas", 1, 0)],
    desc: "1 metro ao redor por 1 rodada, +1 metro por Intenção." },
  { chave: "toque", nome: "Toque", scalings: [escala("Intenção extra", 1, 1)],
    desc: "Alcance 0. Cada Intenção em Toque dá +1 de Intenção a uma outra runa da frase, escolhida na conjuração. O sistema reconhece este gesto pelo nome." }
];

/** Modificadores: gestos que escalam a magia de outras formas. */
const MODIFICADORES = [
  { chave: "amplo", nome: "Amplo", scalings: [escala("Amplitude", 1, 1)],
    desc: "+1 na amplitude da Forma por Intenção." },
  { chave: "longo", nome: "Longo", scalings: [escala("Passos", 1, 1)],
    desc: "+1 passo de alcance por Intenção. Os passos são 1, 3, 6, 20, 60 e 200 metros, e seguem subindo. O sistema reconhece este gesto pelo nome." },
  { chave: "persistente", nome: "Persistente", scalings: [escala("Duração (min)", 1, 1)],
    desc: "Aumenta a duração em 1 minuto, +1 minuto por Intenção." },
  { chave: "preciso", nome: "Preciso", scalings: [escala("Precisão", 2, 2)],
    desc: "+2 na DT da magia ou no teste de mira, por Intenção." },
  { chave: "dividir", nome: "Dividir", scalings: [escala("Alvos", 2, 1)],
    desc: "2 alvos, +1 alvo por Intenção. O dano é dividido entre eles. O sistema reconhece este gesto pelo nome." }
];

/** Id estável: regerar não troca o id, então a runa já usada não vira outra. */
function idEstavel(...partes) {
  const hash = crypto.createHash("sha1").update(partes.join("|")).digest("hex");
  return BigInt(`0x${hash}`).toString(36).padStart(16, "0").slice(0, 16);
}

function documento({ tipoRuna, chave, nome, scalings, desc, subjulgar = false, folder, sort }) {
  const id = idEstavel("runa", tipoRuna, chave);
  return {
    _id: id,
    _key: `!items!${id}`,
    name: nome,
    type: "runa",
    img: ICONES[chave] ?? "icons/svg/book.svg",
    folder,
    sort,
    system: {
      descricao: `<p>${desc}</p>`,
      tipoRuna,
      // Só o elemento tem subtipo: é a linha da tabela de dano. O gesto é
      // reconhecido pelo nome, quando tem regra própria.
      subtipo: tipoRuna === "elemento" ? chave : "",
      // A palavra é da mesa: "Chamas" para Fogo, "Sopro" para Vento. Fica
      // vazia para o nome do compêndio ser o do elemento ou gesto.
      palavra: "",
      lingua: "humana",
      subjulgar,
      maos: tipoRuna === "elemento" ? 0 : 1,
      tipoDano: "",
      scalings
    },
    effects: [],
    flags: {},
    ownership: { default: 0 }
  };
}

const PASTAS = [
  { chave: "elemento", nome: "Elementos" },
  { chave: "forma", nome: "Formas" },
  { chave: "modificador", nome: "Gestos Modificadores" }
];

function main() {
  fs.rmSync(SAIDA, { recursive: true, force: true });
  fs.mkdirSync(SAIDA, { recursive: true });

  const arquivos = [];
  const escrever = (nomeArquivo, doc) => {
    arquivos.push(nomeArquivo);
    fs.writeFileSync(path.join(SAIDA, nomeArquivo), JSON.stringify(doc, null, 2) + "\n", "utf8");
  };

  const idPasta = {};
  PASTAS.forEach((pasta, i) => {
    const id = idEstavel("pasta", "runa", pasta.chave);
    idPasta[pasta.chave] = id;
    escrever(`_pasta-${pasta.chave}.json`, {
      _id: id, _key: `!folders!${id}`, name: pasta.nome, type: "Item",
      folder: null, sorting: "m", sort: (i + 1) * 100000, color: null
    });
  });

  ELEMENTOS.forEach((el, i) => {
    const scalings = el.dano
      ? [escala("Dano", el.dano[0], el.dano[1], el.dano[2]), ...(el.extras ?? [])]
      : [];
    escrever(`elemento-${el.chave}.json`, documento({
      tipoRuna: "elemento", chave: el.chave, nome: el.nome, scalings, desc: el.desc,
      subjulgar: !!el.subjulgar, folder: idPasta.elemento, sort: (i + 1) * 100000
    }));
  });

  for (const [tipoRuna, lista] of [["forma", FORMAS], ["modificador", MODIFICADORES]]) {
    lista.forEach((gesto, i) => {
      escrever(`${tipoRuna}-${gesto.chave}.json`, documento({
        tipoRuna, chave: gesto.chave, nome: gesto.nome, scalings: gesto.scalings,
        desc: gesto.desc, folder: idPasta[tipoRuna], sort: (i + 1) * 100000
      }));
    });
  }

  const total = ELEMENTOS.length + FORMAS.length + MODIFICADORES.length;
  console.log(`${total} runas em ${arquivos.length} arquivos:`);
  console.log(`  ${String(ELEMENTOS.length).padStart(3)}  Elementos`);
  console.log(`  ${String(FORMAS.length).padStart(3)}  Formas`);
  console.log(`  ${String(MODIFICADORES.length).padStart(3)}  Gestos Modificadores`);
}

main();
