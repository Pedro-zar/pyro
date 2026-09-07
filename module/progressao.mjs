/**
 * Nível por uso (SRD 3b, Magia): classificação de rolagens em rotineira,
 * difícil e muito difícil, e o avanço de nível que essas rolagens acumulam.
 * As funções de conta são puras (sem Foundry) para poderem ser testadas fora
 * do cliente; só registrarUso toca em documentos.
 */

import { PYRO } from "./config.mjs";

export const CLASSES = ["rotineira", "dificil", "muitoDificil"];

/* -------------------------------------------------------------------------- */
/*  Classificação de uma rolagem                                              */
/* -------------------------------------------------------------------------- */

/**
 * Distribuição exata do total de uma pool: índice = total, valor = número de
 * combinações. Convolução dado a dado; as pools do sistema (até 18d6, 10d12)
 * têm poucas centenas de totais possíveis.
 * @param {Array<{n: number, faces: number}>} dados
 */
export function distribuicaoDaPool(dados) {
  let dist = [1];
  for (const { n, faces } of dados) {
    for (let i = 0; i < n; i++) {
      const proxima = new Array(dist.length + faces).fill(0);
      for (let total = 0; total < dist.length; total++) {
        if (!dist[total]) continue;
        for (let face = 1; face <= faces; face++) proxima[total + face] += dist[total];
      }
      dist = proxima;
    }
  }
  return dist;
}

/** Chance (0 a 1) de a pool mais o bônus alcançar o ND. */
export function chanceDeSucesso(dados, bonus, nd) {
  const dist = distribuicaoDaPool(dados);
  const combinacoes = dist.reduce((t, c) => t + c, 0);
  let favoraveis = 0;
  for (let total = 0; total < dist.length; total++) {
    if (total + bonus >= nd) favoraveis += dist[total];
  }
  return favoraveis / combinacoes;
}

/**
 * Classe de uma rolagem contra um ND (SRD 3b): rotineira quando o sucesso é
 * 50% ou mais, muito difícil quando o ND passa do máximo possível, difícil no
 * meio. Vantagens e bônus fixos já devem estar dentro de `dados` e `bonus`;
 * bônus de Força de Vontade ficam de fora por regra.
 * @param {object} rolagem
 * @param {Array<{n: number, faces: number}>} rolagem.dados pool vazia = valor fixo (atributo 1).
 * @param {number} [rolagem.bonus]
 * @param {number} rolagem.nd
 * @returns {"rotineira"|"dificil"|"muitoDificil"}
 */
export function classificarRolagem({ dados, bonus = 0, nd }) {
  const maximo = dados.reduce((t, d) => t + d.n * d.faces, 0) + bonus;
  if (nd > maximo) return "muitoDificil";
  return chanceDeSucesso(dados, bonus, nd) >= 0.5 ? "rotineira" : "dificil";
}

/**
 * Pool de um teste de atributo já com vantagens e desvantagens aplicadas.
 * Pool sem dados (atributo 1) rende total fixo 1, que entra como bônus.
 */
export function poolDoTeste({ n, faces }, { vantagem = 0, desvantagem = 0, bonus = 0 } = {}) {
  if (faces === 0) return { dados: [], bonus: bonus + 1 };
  const total = Math.max(0, n + vantagem - desvantagem);
  return { dados: total ? [{ n: total, faces }] : [], bonus };
}

/* -------------------------------------------------------------------------- */
/*  Avanço de nível                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O que é preciso acumular para chegar a `nivelAlvo`. Linhas além da tabela
 * repetem a última: a tabela define até onde a mesa quis, o resto continua
 * no mesmo ritmo.
 * @param {Array<{rr: number, rd: number, rmd: number, modo: "ou"|"e"}>} tabela
 */
export function requisitoDoNivel(tabela, nivelAlvo) {
  if (!tabela?.length) return null;
  const indice = Math.min(Math.max(1, nivelAlvo), tabela.length) - 1;
  return tabela[indice];
}

/**
 * "ou": RR e (RD ou RMD). "e": RR e RD e RMD. As duas leituras aparecem na
 * tabela do SRD (níveis 1–10 e 11–20), então o modo é dado da linha.
 */
export function requisitoCumprido(requisito, contadores) {
  if (!requisito) return false;
  const { rotineiras = 0, dificeis = 0, muitoDificeis = 0 } = contadores;
  if (rotineiras < (requisito.rr ?? 0)) return false;
  const rd = dificeis >= (requisito.rd ?? 0);
  const rmd = muitoDificeis >= (requisito.rmd ?? 0);
  return requisito.modo === "e" ? rd && rmd : rd || rmd;
}

const CONTADOR_DA_CLASSE = {
  rotineira: "rotineiras",
  dificil: "dificeis",
  muitoDificil: "muitoDificeis"
};

/**
 * Soma uma rolagem ao progresso e decide se o nível sobe. Regra da última
 * rolagem (SRD 3b): o requisito só vale se quem o fechou foi difícil ou
 * muito difícil, então uma rotineira nunca sobe nível mesmo completando a
 * conta. Ao subir, os contadores zeram.
 * @param {{nivel: number, nivelMax: number, contadores: object}} progresso
 * @param {string} classe
 * @param {Array} tabela
 * @returns {{nivel: number, contadores: object, subiu: boolean}}
 */
export function avancar(progresso, classe, tabela) {
  const contadores = { ...progresso.contadores };
  contadores[CONTADOR_DA_CLASSE[classe]] += 1;

  const alvo = progresso.nivel + 1;
  const podeSubir = classe !== "rotineira"
    && alvo <= progresso.nivelMax
    && requisitoCumprido(requisitoDoNivel(tabela, alvo), contadores);
  if (!podeSubir) return { nivel: progresso.nivel, contadores, subiu: false };
  return {
    nivel: alvo,
    contadores: { rotineiras: 0, dificeis: 0, muitoDificeis: 0 },
    subiu: true
  };
}

/** Bônus de perícia por nível (SRD 3b): +1 por nível e +1 vantagem a cada 5. */
export function bonusPorNivel(nivel) {
  return { bonus: nivel, vantagens: Math.floor(nivel / 5) };
}

/** O que passa de 10 dobra: 11 vira 12, 15 vira 20, 30 vira 50 (SRD 3b). */
const dobrarAcimaDe10 = nd => (nd <= 10 ? nd : 10 + 2 * (nd - 10));

/**
 * ND que o teste de perícia precisa alcançar. Sem a perícia aprendida (nível
 * 0) o que passa de 10 dobra; sem as ferramentas que ela exige, dobra de novo
 * por cima. A classe da rolagem continua medida pelo ND original.
 */
export function ndAjustado(nd, { semTreino = false, semFerramentas = false } = {}) {
  let ajustado = Number(nd) || 0;
  if (semTreino) ajustado = dobrarAcimaDe10(ajustado);
  if (semFerramentas) ajustado = dobrarAcimaDe10(ajustado);
  return ajustado;
}

/* -------------------------------------------------------------------------- */
/*  Integração com documentos                                                 */
/* -------------------------------------------------------------------------- */

/** A trilha de avanço de um item vem do data model dele (TRILHA_AVANCO). */
export function tabelaDoItem(item) {
  const trilha = item?.system?.constructor?.TRILHA_AVANCO;
  return trilha ? PYRO.avancoPorUso?.[trilha] ?? null : null;
}

/**
 * Registra um uso no item e grava o resultado. Avisa no chat quando o nível
 * sobe. Devolve null quando o item não progride por uso.
 */
export async function registrarUso(item, classe) {
  const tabela = tabelaDoItem(item);
  const progresso = item?.system?.progresso;
  if (!tabela || !progresso || !CLASSES.includes(classe)) return null;

  const resultado = avancar(progresso, classe, tabela);
  await item.update({
    "system.progresso.nivel": resultado.nivel,
    "system.progresso.contadores": resultado.contadores
  });

  if (resultado.subiu) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      content: `<p class="pyro-subiu-nivel">${game.i18n.format("PYRO.Uso.SubiuNivel", {
        nome: Handlebars.escapeExpression(item.name), nivel: resultado.nivel
      })}</p>`
    });
  }
  return resultado;
}

/**
 * O requisito do próximo nível em uma frase.
 *
 * "2 rotineiras. 1 difícil ou 1 muito difícil" — o ponto separa o que é
 * obrigatório e o "ou" mostra onde há escolha. A quebra em rótulo e valores
 * soltos, que era o formato antigo, desalinhava a ficha e ainda precisava de
 * um "todas estas" para dizer o óbvio.
 *
 * Classe que o nível não pede sai da frase: "0 difíceis" não é requisito.
 * @returns {null|{nivel: number, noMaximo?: boolean, texto: string}}
 */
export function descreverRequisito(item) {
  const progresso = item?.system?.progresso;
  const tabela = tabelaDoItem(item);
  if (!progresso || !tabela) return null;
  const nivel = progresso.nivel + 1;
  if (nivel > progresso.nivelMax) {
    return { nivel, noMaximo: true, texto: game.i18n.localize("PYRO.Uso.NoMaximo") };
  }
  const req = requisitoDoNivel(tabela, nivel);
  const loc = k => game.i18n.localize(k);
  // Minúscula porque aqui as classes estão dentro de uma frase, e não como
  // rótulo de campo — "2 Rotineiras" no meio do texto lê como nome próprio.
  const plural = (n, um, varios) =>
    (n > 0 ? `${n} ${loc(n === 1 ? um : varios).toLocaleLowerCase()}` : "");

  const rotineiras = plural(req.rr, "PYRO.Rolagem.rotineiraUma", "PYRO.Rolagem.rotineiras");
  const outras = [
    plural(req.rd, "PYRO.Rolagem.dificilUma", "PYRO.Rolagem.dificeis"),
    plural(req.rmd, "PYRO.Rolagem.muitoDificilUma", "PYRO.Rolagem.muitoDificeis")
  ].filter(Boolean);

  // Uma classe só não precisa de conector; duas ligam por "ou" quando a
  // tabela deixa escolher, e viram frases separadas quando ela pede as duas.
  const ligacao = req.modo === "e" ? ". " : ` ${loc("PYRO.Uso.Ou")} `;
  return {
    nivel,
    texto: [rotineiras, outras.join(ligacao)].filter(Boolean).join(". ")
  };
}

/** Rótulo curto da classe para os cards. */
export function rotuloDaClasse(classe) {
  return game.i18n.localize(PYRO.classesDeRolagem[classe] ?? "");
}

/**
 * Linha do card com a classe da rolagem e, quando há um item que progride,
 * o botão de contar o uso. A contagem é manual por regra: várias conjurações
 * para o mesmo objetivo valem um uso só, e quem sabe disso é o jogador.
 */
export function htmlClasseDaRolagem(classe, item = null) {
  if (!classe) return "";
  const botao = item && tabelaDoItem(item)
    ? `<button type="button" class="pyro-contar-uso" data-item-uuid="${item.uuid}" data-classe="${classe}">
        <i class="fa-solid fa-plus"></i> ${game.i18n.localize("PYRO.Uso.Contar")}
      </button>`
    : "";
  return `<div class="pyro-classe-rolagem classe-${classe}">
    <span>${rotuloDaClasse(classe)}</span>${botao}
  </div>`;
}

/** O que o card grava nas flags do sistema para o botão e para quem ler a mensagem depois. */
export function flagsDaClasse(classe, item = null) {
  return { classeRolagem: classe, usoDe: item?.uuid ?? null };
}
