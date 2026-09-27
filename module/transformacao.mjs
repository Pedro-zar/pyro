/**
 * Contas das transformações que não dependem do documento: a aparência que
 * as formas ligadas pedem e a manutenção que elas cobram com o tempo.
 *
 * Quem entra, sai e cobra é o ator (ver PyroActor). Aqui fica só o que dá
 * para decidir olhando os dados, para a regra ser a mesma na ficha, no card
 * e no relógio.
 */
import { PYRO } from "./config.mjs";
import { calcularFormula } from "./dados.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * A imagem e o token que as formas ligadas pedem, na ordem em que o
 * personagem entrou nelas. Cada campo é decidido sozinho: a última forma que
 * troca o retrato manda no retrato, e a última que troca o token manda no
 * token. Null quando nenhuma forma mexe naquilo, que é o sinal para voltar
 * ao original.
 */
export function aparenciaDasFormas(formas) {
  const ultima = campo => (formas ?? [])
    .map(forma => String(forma?.system?.aparencia?.[campo] ?? "").trim())
    .filter(Boolean)
    .at(-1) ?? null;
  return { retrato: ultima("retrato"), token: ultima("token") };
}

/** De quantos em quantos turnos a forma cobra a manutenção. Zero é nunca. */
export function intervaloDaManutencao(item) {
  const manutencao = item?.system?.manutencao;
  const unidade = PYRO.unidadesDeManutencao[manutencao?.unidade];
  const n = Math.floor(Number(manutencao?.intervalo) || 0);
  return unidade && n > 0 ? n * unidade.turnos : 0;
}

/**
 * O que a forma cobra a cada intervalo, por recurso, já com a fórmula
 * resolvida no nível atual da habilidade. Só os recursos que um custo pode
 * tirar: PV fica de fora, como no fim da forma, porque o que tira vida é
 * dano. A estamina que faltar sai dos PV na hora de pagar, como em qualquer
 * custo (ver pagarCustos).
 */
export function custoDaManutencao(item) {
  const dados = item?.getRollData?.() ?? {};
  const cobra = {};
  for (const { recurso, valor: formula } of item?.system?.manutencao?.custos ?? []) {
    if (!PYRO.recursosDeGasto().includes(recurso)) continue;
    const valor = Math.max(0, Math.round(calcularFormula(String(formula ?? ""), dados)));
    if (valor > 0) cobra[recurso] = (cobra[recurso] ?? 0) + valor;
  }
  return cobra;
}

/**
 * Quantas cobranças cabem no tempo que passou, e o que sobra para a próxima.
 *
 * O tempo só conta enquanto a forma estava ligada: fora de combate uma hora
 * passa de uma vez, e uma forma de um minuto não pode ser cobrada pelos
 * outros cinquenta e nove. `restam` é o que faltava do prazo quando o tempo
 * começou a correr, ou null numa forma sem prazo.
 *
 * A manutenção é o preço de continuar. O intervalo que fecha no mesmo
 * instante em que o prazo acaba não é cobrado, porque ali a forma não
 * continua: uma forma de três minutos a 1 por minuto paga 2.
 */
export function cobrancasDaManutencao({ acumulado = 0, turnos = 1, restam = null, intervalo = 0 }) {
  if (!(intervalo > 0)) return { vezes: 0, resto: 0 };
  const semPrazo = restam === null || restam === undefined;
  const falta = semPrazo ? Infinity : Math.max(0, Number(restam) || 0);
  const ligada = Math.max(0, Math.min(turnos, falta));
  const total = (Number(acumulado) || 0) + ligada;
  const acaba = ligada >= falta;
  const vezes = Math.floor((acaba ? total - 1 : total) / intervalo);
  return { vezes: Math.max(0, vezes), resto: total - Math.max(0, vezes) * intervalo };
}

/**
 * Quantas das cobranças devidas o personagem consegue pagar. Recurso que
 * falta limita a conta. Estamina não limita, porque o que falta dela sai dos
 * PV (ver pagarCustos). Numa hora de estrada com mana para vinte minutos, a
 * forma paga os vinte e cai, em vez de cair sem pagar nada.
 */
export function cobrancasPagaveis(cobra, recursos, vezes) {
  let pagaveis = vezes;
  for (const [chave, valor] of Object.entries(cobra ?? {})) {
    if (chave === "estamina" || !(valor > 0)) continue;
    const atual = Math.max(0, Number(recursos?.[chave]?.value) || 0);
    pagaveis = Math.min(pagaveis, Math.floor(atual / valor));
  }
  return Math.max(0, pagaveis);
}

/** Nome do recurso como o card escreve. */
export const nomeDoRecurso = chave =>
  loc(PYRO.recursosCustom?.[chave]?.label ?? `PYRO.Recursos.${chave}`);

/**
 * "1 de estamina a cada 1 minuto". Vazio quando a forma não cobra nada com o
 * tempo, para o card e a ficha não anunciarem uma manutenção que não existe.
 */
export function textoDaManutencao(item) {
  const intervalo = Math.floor(Number(item?.system?.manutencao?.intervalo) || 0);
  const unidade = PYRO.unidadesDeManutencao[item?.system?.manutencao?.unidade];
  const cobra = custoDaManutencao(item);
  if (!intervaloDaManutencao(item) || !Object.keys(cobra).length) return "";
  const custos = Object.entries(cobra)
    .map(([chave, valor]) => loc("PYRO.Transformacao.Manutencao.Parcela",
      { valor, recurso: nomeDoRecurso(chave) }))
    .join(", ");
  return loc("PYRO.Transformacao.Manutencao.Texto", {
    custos, n: intervalo, unidade: loc(intervalo === 1 ? unidade.um : unidade.varios)
  });
}
