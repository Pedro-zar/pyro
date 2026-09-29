/**
 * O que decide se um efeito vale agora e com que números: por que ele está
 * parado, as @variáveis que os valores dele enxergam e o arredondamento dos
 * campos inteiros.
 *
 * Fica fora do documento de efeito porque o sistema faz as mesmas perguntas
 * por conta própria (dano, custo e alcance em efeitos.mjs, a lista da ficha,
 * a prévia do construtor), e a resposta tem de ser uma só.
 */
import { PYRO } from "./config.mjs";
import { flagsDe, formasAtivas, SYSTEM_ID } from "./sistema.mjs";
import { degrausDeNivel } from "./dados.mjs";

/**
 * Por que um efeito não está valendo agora, fora o "desligado" que o jogador
 * escolhe e a restrição a itens (que vale, só que na rolagem daqueles itens).
 * Null quando nada o segura.
 *
 * Mora fora da classe porque o sistema pergunta a mesma coisa ao ler dano,
 * custo e alcance por conta própria (ver efeitos.mjs), e a ficha usa a
 * resposta para dizer em que lista o efeito cai.
 *
 * @returns {"postura"|"forma"|"guardado"|"vencido"|null}
 */
export function motivoDaPausa(efeito) {
  const dono = efeito?.parent;
  if (dono?.documentName === "Item") {
    // Efeito de uma postura ou de uma transformação só vale enquanto aquela
    // forma está ativa (SRD Técnicas). Postura é uma só por vez, e
    // transformações valem várias juntas.
    if (dono.system?.ehPostura && dono.actor?.getFlag(SYSTEM_ID, "postura") !== dono.id) return "postura";
    if (dono.system?.ehTransformacao && !formasAtivas(dono.actor).includes(dono.id)) return "forma";
    // Armadura no chão não protege e tocha na mochila não ilumina. Só
    // pergunta a quem tem o campo: habilidade e magia não se equipam.
    if (dono.system?.equipado === false) return "guardado";
    // Efeito que mora num item vale enquanto o item vale: ninguém conta o
    // prazo dele (o relógio de tempo.mjs só desconta os efeitos do ator).
    return null;
  }
  /*
   * Prazo vencido no relógio do mundo. Quem apaga os efeitos com prazo é o
   * relógio do combate; isto cobre o que foi aplicado fora de combate, onde
   * ninguém passa turno: o efeito continua listado, mas para de somar assim
   * que o tempo do mundo passa por ele.
   */
  const d = efeito?.duration;
  if (Number.isFinite(d?.value) && Number(d.remaining) <= 0) return "vencido";
  return null;
}

/** O efeito está preso a itens: vale só na rolagem deles, não na ficha. */
export const presoAItem = efeito => (flagsDe(efeito)?.alvosItem ?? []).length > 0;

/**
 * Atributos que os valores de efeito enxergam: o valor escrito na ficha mais
 * o bônus gravado, sem o que os efeitos somam. Os efeitos são aplicados antes
 * de o total existir, e um "+@for na FOR" leria a si mesmo. Piso 1, como o
 * total da ficha.
 */
export function atributosSemEfeitos(actor) {
  const base = actor?._source?.system?.atributos ?? actor?.system?.atributos ?? {};
  const saida = {};
  for (const chave of Object.keys(PYRO.atributos)) {
    const a = base[chave];
    if (!a) continue;
    saida[chave] = Math.max(1, (Number(a.valor) || 0) + (Number(a.bonus) || 0));
  }
  return saida;
}

/** Nível do item que carrega o efeito (o do progresso, numa técnica). */
export const nivelDoDono = item =>
  Number(item?.system?.progresso?.nivel ?? item?.system?.nivel) || 0;

/**
 * Atributos em jogo, com os efeitos somados. É o que valem as @variáveis
 * lidas na hora de usar (dano, custo, alcance, o efeito de uso entregue ao
 * alvo), quando o total já existe.
 */
export function atributosEmJogo(actor) {
  const saida = atributosSemEfeitos(actor);
  for (const chave of Object.keys(saida)) {
    const total = Number(actor?.system?.atributos?.[chave]?.total);
    if (Number.isFinite(total)) saida[chave] = total;
  }
  return saida;
}

/**
 * As @variáveis de um valor de efeito: os atributos de quem tem o efeito, o
 * @nvl do item onde ele mora (0 num efeito do próprio ator) e os degraus
 * @nvl1 a @nvl100 desse nível.
 *
 * @param {Actor|null} actor quem tem o efeito.
 * @param {Item|null} [item] o item onde o efeito mora.
 * @param {boolean} [opcoes.naFicha] a conta de um campo da ficha, feita na
 *   preparação: os atributos entram sem efeitos (ver atributosSemEfeitos).
 */
export function variaveisDeEfeito(actor, item = null, { naFicha = false } = {}) {
  const atributos = naFicha ? atributosSemEfeitos(actor) : atributosEmJogo(actor);
  const nvl = item ? nivelDoDono(item) : 0;
  // @nvl5, @nvl10...: 1 do nível escrito em diante, 0 antes (ver degrau).
  return { ...atributos, nvl, ...degrausDeNivel(nvl) };
}

/** As variáveis de um efeito já criado, pelo dono dele. */
export function variaveisDoEfeito(efeito, opcoes = {}) {
  const item = efeito?.parent?.documentName === "Item" ? efeito.parent : null;
  const actor = item ? item.actor : (efeito?.parent?.documentName === "Actor" ? efeito.parent : null);
  return variaveisDeEfeito(actor, item, opcoes);
}

/**
 * Valor final de uma mudança num campo inteiro. O Foundry valida o resultado
 * contra o campo, e um "×0,5" em 7 ações daria 3,5, que um campo inteiro
 * recusa: a linha seria descartada em silêncio e o efeito pareceria não
 * fazer nada. Aqui a conta arredonda para baixo, como todo o SRD.
 *
 * @returns {number|null} o valor arredondado, ou null quando a conta já dá
 *   inteiro e a linha pode seguir o caminho normal.
 */
export function valorInteiroDaMudanca(tipo, atual, delta) {
  const contas = {
    add: () => atual + delta,
    subtract: () => atual - delta,
    multiply: () => atual * delta,
    override: () => delta,
    upgrade: () => Math.max(atual, delta),
    downgrade: () => Math.min(atual, delta)
  };
  const conta = contas[tipo];
  if (!conta || !Number.isFinite(atual) || !Number.isFinite(delta)) return null;
  const final = conta();
  return Number.isInteger(final) ? null : Math.floor(final);
}

/*
 * Funções de conta que o Roll do Foundry entende numa fórmula sem dado. São
 * as mesmas nos campos da ficha, que o núcleo avalia com o Roll, e no que o
 * sistema lê por conta própria.
 */
const FUNCOES_DE_CONTA = /\b(?:floor|ceil|round|trunc|abs|min|max|sqrt|pow|sign)\b/gi;
const SO_ARITMETICA = /^[\d\s+\-*/().,]+$/;

/**
 * O número de uma conta sem variáveis ("4 * 15", "floor(15 / 2)"). NaN
 * quando sobra qualquer coisa que não seja número, operador ou uma daquelas
 * funções: um dado, uma @variável sem valor, texto solto.
 */
export function avaliarConta(texto) {
  const t = String(texto ?? "").trim();
  if (!t || !SO_ARITMETICA.test(t.replace(FUNCOES_DE_CONTA, ""))) return NaN;
  try {
    const valor = Roll.safeEval(t);
    return Number.isFinite(valor) ? valor : NaN;
  } catch {
    return NaN;
  }
}

/*
 * Linhas de dados das reações: somar põe dados a mais, multiplicar
 * multiplica quantos dados rolam. O campo de dados a mais guarda só o que
 * foi somado (zero, quase sempre), e multiplicar ali daria zero; a conta vai
 * para o multiplicador de dados, que a ficha aplica na fórmula inteira.
 */
const MULT_DE_DADOS = {
  "system.bloqueioBonus": "system.bloqueioMult",
  "system.esquivaBonus": "system.esquivaMult"
};

/** O campo que uma mudança altera de fato (ver MULT_DE_DADOS). */
export const chaveDaMudanca = (chave, tipo) =>
  (tipo === "multiply" && MULT_DE_DADOS[chave]) || chave;
