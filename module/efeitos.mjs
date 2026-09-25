/**
 * Efeitos de uso: o que um item entrega ao alvo, e não a quem carrega.
 *
 * Vive fora de item.mjs e magia.mjs porque os dois montam cards de chat com
 * os mesmos botões — arma, consumível, habilidade, feitiço e conjuração de
 * magia. Aqui também mora a resolução das @variáveis publicadas pelo card,
 * que é o que permite um efeito dizer "alcance = @alcance" em vez de um
 * número fixo escolhido quando o efeito foi criado.
 */

import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { SYSTEM_ID, flagsDe, flagsDoSistema, naFila } from "./sistema.mjs";
import { UNIDADE_PADRAO, dadosDePrazo } from "./duracao.mjs";


/* -------------------------------------------------------------------------- */
/*  Efeitos restritos a itens                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Itens a que um efeito está preso. Lista vazia significa "vale sempre".
 * Cada entrada guarda id e nome: o id resolve na ficha em que o efeito nasceu,
 * o nome salva a referência quando o efeito viaja para outro personagem ou o
 * item é recriado.
 */
export function restricaoDoEfeito(efeito) {
  return flagsDe(efeito)?.alvosItem ?? [];
}

/**
 * Este efeito vale para este item? Sem restrição, vale para qualquer um.
 * Uma entrada pode prender o efeito a um tipo inteiro ("todas as magias") ou a
 * um item específico. No item específico o id resolve primeiro e o nome é a
 * rede de segurança; num alvo de tipo o nome é só rótulo, e não entra na
 * comparação, senão um item chamado "Magia" casaria por acidente.
 */
export function efeitoValeParaItem(efeito, item) {
  const alvos = restricaoDoEfeito(efeito);
  if (!alvos.length) return true;
  if (!item) return false;
  const nome = PYRO.normalizarTexto(item.name);
  return alvos.some(a => a.tipo
    ? a.tipo === item.type
    : (a.id === item.id || (!!a.nome && PYRO.normalizarTexto(a.nome) === nome)));
}

/** Efeitos ativos do ator, incluindo os que estão presos a algum item. */
/**
 * Efeito de uma postura ou de uma transformação que não é a forma ativa do
 * dono. O mesmo portão do PyroActiveEffect, para o que o sistema lê por fora do
 * core (bônus de dano, custos, atributos presos a item): sem ele, a guarda
 * desligada seguiria dando o desconto dela.
 */
const deFormaInativa = efeito => {
  const item = efeito.parent;
  if (!(item instanceof Item)) return false;
  const chave = item.system?.ehPostura ? "postura"
    : item.system?.ehTransformacao ? "transformacao" : null;
  if (!chave) return false;
  return item.actor?.getFlag(SYSTEM_ID, chave) !== item.id;
};

/**
 * Efeito de um equipamento que está guardado. O mesmo portão do
 * PyroActiveEffect: a tocha na mochila não acende e a armadura no chão não
 * defende, aqui também.
 */
const deItemGuardado = efeito =>
  efeito.parent instanceof Item && efeito.parent.system?.equipado === false;

/**
 * Prazo vencido no relógio do mundo. O mesmo portão do PyroActiveEffect: o
 * efeito continua listado até alguém apagá-lo, mas para de somar na hora em
 * que o tempo passa por ele — e isso vale para o que o sistema lê por fora do
 * core (dano, custo, alcance) como vale para as mudanças de campo.
 */
const dePrazoVencido = efeito => {
  const d = efeito?.duration;
  return !!d?.seconds && Number(d.remaining) <= 0;
};

function efeitosAtivos(actor) {
  const lista = [];
  for (const efeito of actor?.allApplicableEffects?.() ?? []) {
    // `disabled` é escolha do jogador. Efeito preso a item aparece aqui de
    // propósito: ele está suprimido na ficha, mas vale na rolagem certa. Já
    // o de uma forma desligada não vale em canto nenhum.
    if (!efeito.disabled && !deFormaInativa(efeito) && !deItemGuardado(efeito)
        && !dePrazoVencido(efeito)) {
      lista.push(efeito);
    }
  }
  return lista;
}

/**
 * O efeito vale para algum destes itens? Uma técnica golpeia COM uma arma,
 * então o dano extra preso à katana entra também na técnica que a usa —
 * quem chama passa [tecnica, arma] e o efeito vale se casar com qualquer um.
 */
const valeParaAlgum = (efeito, itens) =>
  // Sem item nenhum para casar (a frase de magia montada na hora não é um
  // item), vale a mesma regra de sempre: efeito sem restrição entra, efeito
  // preso a alguma coisa fica de fora.
  (itens.length ? itens : [null]).some(i => efeitoValeParaItem(efeito, i));

/** Ordena mantendo quem empata na ordem em que já estava (sort estável). */
const ordenarPorOrdem = lista => [...lista].sort((x, y) => x.ordem - y.ordem);

/**
 * Rolagens de dano que os efeitos somam a este item. A fórmula aceita dado,
 * número plano ou os dois ("2d6", "2", "2d6+2", "2d6+1d4").
 */
export function bonusDeDano(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const saida = [];
  for (const efeito of efeitosAtivos(actor)) {
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const dano of flagsDe(efeito)?.danos ?? []) {
      if (!dano.formula?.trim()) continue;
      /*
       * O @nvl da fórmula é o do item DONO do efeito (a postura, a
       * habilidade), resolvido aqui — na rolagem a fórmula corre com os
       * dados do item atacante, onde @nvl seria o da arma ou viraria 0.
       */
      saida.push({
        ...dano,
        ordem: Math.round(Number(dano.ordem)) || 0,
        formula: resolverValorEfeito(dano.formula, varsDoEfeito(efeito)),
        nome: efeito.name
      });
    }
  }
  /*
   * A ordem escrita na linha decide em que sequência as parcelas entram no
   * card. Elas se somam de qualquer jeito — o que muda é a leitura, e quem
   * quer o "Maestria com Katana" antes do veneno consegue.
   */
  return ordenarPorOrdem(saida);
}

/**
 * Multiplicadores de dano que os efeitos aplicam às rolagens deste item
 * (Pugilista: "1 + 0.25 * @nvl"). A fórmula resolve aqui, com o @nvl do item
 * dono do efeito; tipo vazio multiplica todo dano, tipo preenchido só aquela
 * parcela. Fator 1 é ausência e fator negativo é erro de digitação — nenhum
 * dos dois entra.
 */
export function multiplicadoresDeDano(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const saida = [];
  for (const efeito of efeitosAtivos(actor)) {
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const m of flagsDe(efeito)?.multsDano ?? []) {
      const fator = Number(resolverValorEfeito(m.formula, varsDoEfeito(efeito)));
      if (!Number.isFinite(fator) || fator < 0 || fator === 1) continue;
      saida.push({ tipo: m.tipo || "", fator, nome: efeito.name });
    }
  }
  return saida;
}

/**
 * Operações de alcance que os efeitos ativos impõem a este item, na ordem em
 * que devem ser aplicadas.
 *
 * Cada linha soma metros (com sinal: negativo encurta) ou multiplica o
 * alcance. Como as duas coisas convivem, a ordem muda o resultado — "+1 e
 * depois x2" dá 4 onde "x2 e depois +1" dá 3 —, e quem decide é a ordem
 * escrita na linha: 0 antes de 1, 1 antes de 2. Sem número escrito, vale 0.
 *
 * O empate mantém a ordem de sempre (os efeitos na ordem em que o ator os
 * entrega, e as linhas na ordem em que foram escritas): o sort é estável.
 *
 * A fórmula resolve aqui, com o @nvl do item dono do efeito, como no dano.
 */
export function operacoesDeAlcance(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const ops = [];
  for (const efeito of efeitosAtivos(actor)) {
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const a of flagsDe(efeito)?.alcances ?? []) {
      const valor = Number(resolverValorEfeito(a.formula, varsDoEfeito(efeito)));
      if (!Number.isFinite(valor)) continue;
      const multiplica = a.modo === "multiply";
      // Somar zero e multiplicar por um não mexem em nada, e fator negativo é
      // erro de digitação — nenhum dos três entra, nem na lista de origens.
      if (multiplica ? (valor === 1 || valor < 0) : valor === 0) continue;
      ops.push({
        ordem: Math.round(Number(a.ordem)) || 0,
        multiplica, valor, nome: efeito.name
      });
    }
  }
  return ordenarPorOrdem(ops);
}

/**
 * O alcance final de uma conta encadeada, em metros inteiros.
 *
 * A conta começa em ZERO e percorre tudo na ordem escrita, somando ou
 * multiplicando: as parcelas do próprio item (o alcance do corpo na ordem 0,
 * o da arma ou do traço na ordem 2) e as linhas dos efeitos, misturadas numa
 * fila só. Um "x2" multiplica o que já entrou na fila e mais nada: antes de
 * toda parcela ele multiplica zero e não faz efeito nenhum, e entre o corpo e
 * a arma ele dobra o corpo e deixa a arma de fora.
 *
 * Empate de ordem: as parcelas do item vêm antes das linhas de efeito, que é
 * o que faz "x2 na ordem 2" dobrar a arma em vez de ignorá-la.
 *
 * O arredondamento é um só, no fim: uma linha que corta pela metade seguida
 * de uma que dobra devolve o número de partida, e não um metro perdido no
 * caminho. Para baixo, como o resto do SRD, e nunca abaixo de zero.
 *
 * @param {Array<{valor: number, ordem: number}>} partes o que o item vale.
 * @param {object[]} [ops] as linhas de efeito (ver operacoesDeAlcance).
 */
export function alcanceAjustado(partes, ops = []) {
  const fila = ordenarPorOrdem([
    ...partes.map(p => ({ ...p, multiplica: false })),
    ...ops
  ]);
  let valor = 0;
  for (const op of fila) valor = op.multiplica ? valor * op.valor : valor + op.valor;
  return Math.max(0, Math.floor(valor));
}

/**
 * Alcance de uma arma: o do corpo mais o da arma, e o que os efeitos fizerem
 * com os dois.
 *
 * O braço entra antes da arma (SRD: o alcance do tamanho), então a adaga de
 * 0m de um médio chega ao adjacente e a alabarda de 2m chega a 3m. Quem tem
 * alcance de corpo 0 — o minúsculo — ataca com a adaga no próprio quadrado, e
 * é assim que a tabela de tamanhos fecha.
 *
 * O máximo zero é o que diz "corpo a corpo" para o resto do sistema (a mira,
 * o filtro de técnica distante), então ele continua zero por mais metros que
 * um efeito dê, e nunca cai a zero por uma redução: esticar o braço não
 * transforma a adaga em arma de arremesso, nem o contrário. Quem quiser uma
 * arma arremessável preenche o alcance máximo dela.
 *
 * O menor não tem esse piso porque zero ali é um alcance de verdade, e não
 * uma categoria: é o que o minúsculo de mãos vazias tem, e quer dizer "só no
 * próprio quadrado".
 *
 * @param {object[]} [opcoes.extras] outros itens a que o efeito pode estar
 *   preso — a técnica que golpeia com esta arma, tipicamente.
 * @param {boolean} [opcoes.efeitos] false calcula só o corpo mais a arma, sem
 *   as linhas de efeito (ver ataquesDaTecnica).
 */
export function alcanceDaArma(actor, arma, { extras = [], efeitos = true } = {}) {
  const sys = arma?.system ?? {};
  const corpo = { ordem: PYRO.ORDEM_CORPO, valor: actor?.system?.alcanceTamanho ?? 0 };
  const partes = metros => [corpo, { ordem: PYRO.ORDEM_BASE, valor: metros }];
  const ops = efeitos ? operacoesDeAlcance(actor, [arma, ...extras]) : [];

  const semEfeitos = m => alcanceAjustado(partes(m));
  const base = {
    menor: semEfeitos(sys.alcanceMenor ?? 0),
    maximo: sys.alcanceMaximo > 0 ? Math.max(1, semEfeitos(sys.alcanceMaximo)) : 0
  };
  const menor = ops.length ? alcanceAjustado(partes(sys.alcanceMenor ?? 0), ops) : base.menor;
  const maximo = base.maximo > 0
    ? Math.max(1, alcanceAjustado(partes(sys.alcanceMaximo), ops)) : 0;
  return {
    base, menor, maximo,
    // Operação que não mexeu no número (dobrar um alcance de 0, por exemplo)
    // não rende nota nenhuma no card.
    mudou: menor !== base.menor || maximo !== base.maximo,
    nomes: [...new Set(ops.map(o => o.nome))]
  };
}

/**
 * Alcance de arma em texto ("1m", "20/60m"). Mora junto de alcanceDaArma
 * porque é o número que ela devolve: a ficha, o card do ataque e a prévia da
 * técnica escrevem a mesma coisa, e não três variações do mesmo par.
 */
export function textoDeAlcance(alcance) {
  return alcance.maximo > 0 ? `${alcance.menor}/${alcance.maximo}m` : `${alcance.menor}m`;
}

/**
 * Aplica os multiplicadores às parcelas de dano JÁ ROLADAS, mexendo no total
 * (arredondado para baixo) — é o total das flags que os botões de aplicar
 * dano usam. Devolve uma linha de texto por parcela alterada, para o card
 * explicar por que o número não bate com a rolagem mostrada.
 */
export function aplicarMultDeDano(danos, mults) {
  const notas = [];
  if (!mults.length) return notas;
  for (const dano of danos) {
    const aplicaveis = mults.filter(m => !m.tipo || m.tipo === dano.tipo);
    const fator = aplicaveis.reduce((f, m) => f * m.fator, 1);
    if (fator === 1 || !(dano.total > 0)) continue;
    const antes = dano.total;
    dano.total = Math.max(0, Math.floor(dano.total * fator));
    notas.push(game.i18n.format("PYRO.Efeitos.MultAplicado", {
      nomes: esc([...new Set(aplicaveis.map(m => m.nome))].join(", ")),
      fator: fator.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
      antes, depois: dano.total
    }));
  }
  return notas;
}

/**
 * Quanto os efeitos mexem no custo de usar este item, por chave de
 * PYRO.alvosEfeito.custo (acoes, mana, estamina, energia e os recursos de
 * raça): `{ chave: { soma, mult } }`.
 *
 * Cada linha de custo do efeito soma (um número com sinal, "-2 mana") ou
 * multiplica ("0.5" corta pela metade, "2" dobra). O valor aceita @variáveis,
 * então "metade do custo" e "-1 por nível" convivem na mesma lista.
 */
export function ajustesDeCusto(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const ajustes = {};
  // Cada chave guarda os dois lados: o que somam e o que multiplicam.
  const doAjuste = chave => (ajustes[chave] ??= { soma: 0, mult: 1 });

  for (const efeito of efeitosAtivos(actor)) {
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const custo of flagsDe(efeito)?.custos ?? []) {
      const valor = Number(resolverValorEfeito(custo.valor, varsDoEfeito(efeito)));
      if (!custo.chave || !Number.isFinite(valor)) continue;
      /*
       * Multiplicadores se acumulam multiplicando entre si (metade de metade
       * é um quarto), e os somatórios somando — cada um no seu lado, para a
       * ordem entre dois efeitos não mudar a conta. Fator negativo é erro de
       * digitação e fica de fora.
       */
      if (custo.modo === "multiply") {
        if (valor >= 0) doAjuste(custo.chave).mult *= valor;
      } else {
        doAjuste(custo.chave).soma += valor;
      }
    }
  }

  /*
   * Item arcano equipado abate mana de tudo que gasta mana. Entra por aqui,
   * e não como efeito, para o jogador só precisar equipar o item — e como o
   * desconto vale para qualquer conjuração, ele não olha o item em uso.
   */
  for (const equip of actor?.items ?? []) {
    const sys = equip.system;
    if (equip.type !== "equipamento" || !sys.equipado || sys.categoria !== "arcano") continue;
    if (sys.reducaoMana) doAjuste("mana").soma -= sys.reducaoMana;
  }
  return ajustes;
}

/**
 * Custo já ajustado por um par { soma, mult } vindo de ajustesDeCusto (um
 * número solto ainda é lido como soma).
 *
 * O multiplicador vem primeiro, arredondado para baixo como todo o resto do
 * SRD, e os somatórios entram depois: quem tem "metade do custo" e "-2 mana"
 * paga a metade e ainda abate os 2, e não o contrário. Reduções acumulam mas
 * nunca zeram um custo que existia — o piso é 1, inclusive num fator 0, que
 * aqui não é passe livre. Custo que já era zero segue zero, e ajuste que
 * encarece continua livre.
 */
export function custoAjustado(base, ajuste) {
  const b = Math.round(base ?? 0);
  const { soma = 0, mult = 1 } = (ajuste && typeof ajuste === "object")
    ? ajuste : { soma: Number(ajuste) || 0 };
  const total = Math.max(0, Math.round(Math.floor(b * mult) + soma));
  return (soma < 0 || mult < 1) && b > 0 ? Math.max(1, total) : total;
}

/**
 * Aumentos de atributo que valem só quando este item é usado.
 *
 * Efeito preso a item fica suprimido na ficha, senão um "+2 FOR com a katana"
 * valeria também de mãos vazias. O que ele altera entra aqui, na hora da
 * rolagem daquele item. Só atributos, e só no modo Somar: é o que faz sentido
 * numa rolagem isolada.
 */
/**
 * As variáveis que o item dono de um efeito empresta aos valores dele: @nvl
 * é o nível do item onde o efeito mora (o do progresso, numa técnica). O
 * mesmo @nvl que o core resolve na aplicação (ver getReplacementData no
 * PyroActiveEffect), para os valores que o sistema lê por conta própria.
 */
const varsDoEfeito = efeito => {
  const sys = efeito?.parent instanceof Item ? efeito.parent.system : null;
  return sys ? { nvl: Number(sys.progresso?.nivel ?? sys.nivel) || 0 } : {};
};

export function ajustesDeAtributo(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const ALVO = /^system\.atributos\.(\w+)\.(?:valor|bonus)$/;
  const ajustes = {};
  for (const efeito of efeitosAtivos(actor)) {
    if (!restricaoDoEfeito(efeito).length) continue; // sem restrição já entrou na ficha
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const mudanca of efeito.system?.changes ?? []) {
      if (mudanca.type !== "add") continue;
      const chave = ALVO.exec(mudanca.key)?.[1];
      const valor = Number(resolverValorEfeito(mudanca.value, varsDoEfeito(efeito)));
      if (chave && Number.isFinite(valor)) ajustes[chave] = (ajustes[chave] ?? 0) + valor;
    }
  }
  return ajustes;
}

/** Efeitos de uso ativos de um ou mais itens, sem repetir o mesmo efeito. */
export function efeitosDeUso(...itens) {
  const vistos = new Set();
  const saida = [];
  for (const item of itens.flat().filter(Boolean)) {
    for (const efeito of item.effects ?? []) {
      const flags = flagsDe(efeito);
      // O de fim de forma não é de uso, mesmo que alguém marque os dois na
      // ficha completa do Foundry: ele espera a forma cair, não o card.
      if (!flags?.deUso || flags.aoAcabar || efeito.disabled) continue;
      if (vistos.has(efeito.uuid)) continue;
      vistos.add(efeito.uuid);
      saida.push(efeito);
    }
  }
  return saida;
}

/**
 * Bloco de botões do card do chat, um por efeito de uso. Quem clica decide o
 * alvo: os tokens selecionados, ou o próprio personagem do usuário.
 */
export function htmlEfeitosDeUso(...itens) {
  const lista = efeitosDeUso(...itens);
  if (!lista.length) return "";

  const botoes = lista.map(efeito => `
    <button type="button" class="pyro-aplicar-efeito" data-efeito-uuid="${efeito.uuid}">
      <img src="${efeito.img}" alt="" />
      <span>${esc(efeito.name)}</span>
    </button>`).join("");

  return `<div class="pyro-efeitos-uso">
    <span class="pyro-efeitos-rotulo">${game.i18n.localize("PYRO.Efeitos.AplicarEm")}</span>
    ${botoes}
  </div>`;
}

/**
 * Botões de efeito que a regra da Intenção oferece no card, e não um efeito
 * criado por alguém num item (ver PYRO.regrasDeIntencao e PYRO.regraDosSeis).
 * Os dados do efeito viajam nas flags da mensagem, então o clique não depende
 * de haver um documento por trás.
 * @param {Array<{name: string, img: string}>} lista
 */
export function htmlEfeitosDeRegra(lista) {
  if (!lista?.length) return "";
  // Efeito que volta para quem conjurou avisa no botão: o rótulo da linha fala
  // dos selecionados, e a Defesa de Pedra ignora a seleção.
  const botoes = lista.map((efeito, indice) => `
    <button type="button" class="pyro-efeito-regra" data-indice="${indice}"
            title="${game.i18n.localize(efeito.noConjurador
              ? "PYRO.Efeitos.NoConjurador" : "PYRO.Efeitos.AplicarEm")}">
      <img src="${efeito.img}" alt="" />
      <span>${esc(efeito.name)}</span>
    </button>`).join("");
  return `<div class="pyro-efeitos-uso">
    <span class="pyro-efeitos-rotulo">${game.i18n.localize("PYRO.Efeitos.AplicarEm")}</span>
    ${botoes}
  </div>`;
}

/* -------------------------------------------------------------------------- */
/*  Variáveis do card                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Variáveis que um card do sistema publicou. Conjurações gravam a lista
 * completa (alcance, raio, intenção...); os demais cards oferecem ao menos o
 * dano somado e a cura, que já vêm nas flags para o menu de aplicar.
 */
export function variaveisDaMensagem(message) {
  const flags = flagsDe(message) ?? {};
  const vars = { ...(flags.variaveis ?? {}) };
  if (vars.danoTotal === undefined) {
    vars.danoTotal = (flags.danos ?? []).reduce((t, d) => t + (d.total ?? 0), 0);
  }
  if (vars.cura === undefined) vars.cura = flags.cura ?? 0;
  return vars;
}

/**
 * Troca as @variáveis pelo valor daquela conjuração e resolve a conta quando
 * o que sobra é aritmética ("@alcance / 2" vira "3"). Referências que não
 * estão no mapa ficam intactas, então "@det" continua valendo o DET de quem
 * recebe o efeito, resolvido pelo Foundry na aplicação.
 */
export function resolverValorEfeito(valor, vars) {
  const bruto = String(valor ?? "");
  if (!bruto.includes("@")) return bruto;
  const resolvido = Roll.replaceFormulaData(bruto, vars);
  if (resolvido.includes("@")) return resolvido;
  if (!/^[\d\s+\-*/().]+$/.test(resolvido)) return resolvido;
  try {
    return String(Roll.safeEval(resolvido));
  } catch (erro) {
    console.warn("PYRO | Valor de efeito não pôde ser calculado", bruto, erro);
    return resolvido;
  }
}

/**
 * Cópia do efeito pronta para o alvo: valores e duração já resolvidos com as
 * variáveis do card. É cópia independente de propósito — editar o item depois
 * não mexe em quem já recebeu.
 */
export function dadosDoEfeitoAplicado(efeito, vars) {
  // O nível do item que carrega o efeito entra junto das variáveis do card:
  // "@nvl" num efeito de uso congela no nível que o item tinha ao aplicar —
  // o alvo não herda um @nvl dele mesmo.
  vars = { ...varsDoEfeito(efeito), ...vars };
  const dados = efeito.toObject();
  delete dados._id;
  dados.origin = efeito.uuid;
  dados.transfer = false;
  dados.disabled = false;
  // No núcleo as mudanças do efeito vivem em system.changes.
  dados.system = {
    ...(dados.system ?? {}),
    changes: (dados.system?.changes ?? []).map(m => ({
      ...m,
      value: resolverValorEfeito(m.value, vars)
    }))
  };

  /*
   * O prazo é remontado agora, e não copiado. Duas razões: uma fórmula
   * ("@intencao * 2") só vira número aqui, porque só agora se sabe com que
   * Intenção a magia foi conjurada; e o relógio do prazo começa a contar
   * quando o efeito é aplicado, não quando ele foi escrito no item — o
   * original guarda um começo de meses atrás, que faria a cópia nascer
   * vencida.
   */
  const flags = flagsDe(efeito) ?? {};
  const formula = flags.prazoFormula;
  const unidade = formula?.unidade ?? flags.prazo?.unidade ?? UNIDADE_PADRAO;
  const valor = formula?.formula
    ? Number(resolverValorEfeito(formula.formula, vars))
    : Number(flags.prazo?.valor) || 0;
  const emTempo = Number.isFinite(valor) && valor > 0;
  /*
   * Fórmula manda sempre, inclusive quando ela dá zero. O efeito escrito com
   * fórmula nasce guardado com prazo de 1 só para o construtor poder tratá-lo
   * como temporário (ver construtor-efeito.mjs); aplicar a cópia sem refazer
   * esse prazo entregaria um efeito de um turno a quem escreveu "sem prazo".
   */
  if (emTempo || formula?.formula) {
    const resolvido = dadosDePrazo(emTempo ? valor : 0, unidade);
    dados.duration = { ...(dados.duration ?? {}), ...resolvido.duration };
    dados.flags = foundry.utils.mergeObject(dados.flags ?? {}, resolvido.flags);
  }
  return dados;
}

/* -------------------------------------------------------------------------- */
/*  Exaustão                                                                  */
/* -------------------------------------------------------------------------- */

/** O efeito carrega a condição "exausto"? statuses é Set no documento vivo. */
export function ehExaustao(efeito) {
  const st = efeito.statuses;
  return st?.has ? st.has("exausto") : (st ?? []).includes("exausto");
}

/**
 * Níveis que um efeito de exaustão carrega. O número mora na flag; um efeito
 * com o status mas sem a flag (posto pelo HUD do token, por exemplo) conta
 * como 1.
 */
export function niveisDoEfeito(efeito) {
  const n = Number(flagsDe(efeito)?.exaustao);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * Quantos níveis de exaustão valem agora: a soma dos efeitos ativos com a
 * condição. Cada nível tira 1 de todos os testes (atributo, mira,
 * sobrecarga). O sobrepeso não entra por fora: ele soma +1 no próprio efeito
 * (ver sincronizarSobrepeso), então o que a ficha mostra é o que desconta.
 */
export function nivelExaustao(actor) {
  let total = 0;
  for (const efeito of efeitosAtivos(actor)) {
    if (ehExaustao(efeito)) total += niveisDoEfeito(efeito);
  }
  return total;
}

/**
 * O que a exaustão tira de um teste: -1 fixo por nível e, a cada 5 níveis,
 * uma desvantagem (um dado a menos na pool). Exaustão 7 = -7 e 1 desvantagem.
 * Vale para todo teste que não seja dano: atributo, esquiva, bloqueio, mira
 * e sobrecarga passam por aqui.
 */
export function penalidadeExaustao(actor) {
  const niveis = nivelExaustao(actor);
  return { niveis, bonus: -niveis, desvantagem: Math.floor(niveis / 5) };
}

/** Linha de aviso dos diálogos de teste; vazia sem exaustão. */
export function dicaExaustao(actor) {
  const pen = penalidadeExaustao(actor);
  if (pen.niveis <= 0) return "";
  return pen.desvantagem > 0
    ? game.i18n.format("PYRO.Teste.ExaustaoDesvantagem", { n: pen.niveis, d: pen.desvantagem })
    : game.i18n.format("PYRO.Teste.ExaustaoDica", { n: pen.niveis });
}

/**
 * Este efeito é o acumulador de exaustão do personagem — aquele em que os
 * botões da ficha, o sobrepeso e a sobrecarga escrevem?
 *
 * Ele é reconhecido por uma marca, e não pelo formato: deduzir "sem prazo e
 * nascido do ator" pegava junto qualquer efeito que a mesa escrevesse na
 * ficha com a condição Exausto, e o acumulador renomeia e apaga o que ele
 * adota — uma maldição viraria "Exaustão" e sumiria no primeiro -1.
 */
const ehAcumuladorDeExaustao = efeito => flagsDe(efeito)?.acumulador === true;

/**
 * Exaustão que chega dentro de um efeito vira exaustão do personagem.
 *
 * Uma ressaca de transformação ou uma magia que cansa nascia como um efeito
 * "Exaustão 5" à parte, e a ficha não conseguia mexer nele: os botões de -1 e
 * +1 escrevem no acumulador, não nele, e para tirar um nível era preciso
 * editar o efeito à mão. Em vez de duas contagens, os níveis entram no
 * acumulador — que é criado se ainda não houver — e a linha de exaustão sai
 * do efeito que a trouxe. Se esse efeito não fazia mais nada além disso, ele
 * vai embora inteiro; ele já cumpriu o que tinha a fazer.
 *
 * O prazo que o efeito tivesse não acompanha os níveis: exaustão não vence no
 * relógio, ela sai com descanso (SRD Atributos). Quem escreveu "exausto 2 por
 * dez turnos" fica com dois níveis de verdade, e tira os dois quando a cena
 * pedir.
 */
export async function absorverExaustao(efeito) {
  const actor = efeito?.parent;
  if (!(actor instanceof Actor) || efeito.disabled) return;
  // O acumulador não absorve a si mesmo: seria um laço sem fim.
  if (ehAcumuladorDeExaustao(efeito)) return;
  const flags = flagsDe(efeito) ?? {};
  /*
   * Efeito preso a item vale só na rolagem daquele item, e a exaustão do
   * personagem não tem esse escopo: absorvê-la tornaria global uma exaustão
   * que o autor quis presa à katana.
   */
  if ((flags.alvosItem ?? []).length) return;
  const escrito = Math.round(Number(flags.exaustao));
  // Sem número escrito, um efeito que só carrega a marca de Exausto (o HUD do
  // token, por exemplo) vale um nível — é o que a ficha já contava nele.
  const niveis = Number.isFinite(escrito) && escrito > 0 ? escrito
    : (ehExaustao(efeito) ? 1 : 0);
  if (niveis <= 0) return;

  /*
   * O efeito perde a exaustão ANTES de o acumulador recebê-la. Na ordem
   * contrária os dois carregam os mesmos níveis por um instante, e nesse
   * instante a ficha pode desmaiar alguém por uma exaustão contada em dobro.
   */
  const dados = efeito.toObject();
  const statuses = (dados.statuses ?? []).filter(s => s !== "exausto");
  const fazMaisAlgumaCoisa = (dados.system?.changes ?? []).length > 0
    || statuses.length > 0
    || (flags.danos ?? []).length > 0
    || (flags.multsDano ?? []).length > 0
    || (flags.custos ?? []).length > 0
    || (flags.alcances ?? []).length > 0;
  if (fazMaisAlgumaCoisa) await efeito.update({ statuses, ...apagarExaustao(efeito) });
  else await efeito.delete();

  return aplicarExaustao(actor, niveis);
}

/**
 * Update que apaga o número de exaustão do efeito, no escopo em que ele de
 * fato está: um efeito importado da mesa de produção guarda as flags em
 * "pyro", e apagar no escopo desta mesa deixaria o número lá, para ser
 * absorvido de novo (ver flagsDe).
 */
function apagarExaustao(efeito) {
  const escopo = efeito?.flags?.[SYSTEM_ID] ? SYSTEM_ID : "pyro";
  return { [`flags.${escopo}.-=exaustao`]: null };
}

/**
 * Soma (ou tira, com delta negativo) níveis de exaustão e devolve o total.
 *
 * A exaustão acumula num efeito só, chamado "Exaustão", com o número na
 * flag: quem tem 2 e sofre sobrecarga 2 fica com 4, e não com dois efeitos
 * separados. Chegando a zero o efeito some — nível zero não é exaustão.
 */
export function aplicarExaustao(actor, delta) {
  delta = Number(delta) || 0;
  if (!actor || delta === 0) return nivelExaustao(actor);
  // Na fila: contar exaustão é ler-somar-gravar, e duas sobrecargas quase
  // juntas criariam dois efeitos "Exaustão" em vez de somar num só.
  return naFila(actor, () => somarExaustao(actor, delta));
}

async function somarExaustao(actor, delta) {
  const loc = k => game.i18n.localize(k);

  const existente = actor.effects?.find?.(e => ehAcumuladorDeExaustao(e) && !e.disabled);
  if (existente) {
    const novo = Math.max(0, niveisDoEfeito(existente) + delta);
    if (novo === 0) await existente.delete();
    else await existente.update({ name: loc("PYRO.Exaustao.Nome"), [`flags.${SYSTEM_ID}.exaustao`]: novo });
    return nivelExaustao(actor);
  }
  if (delta < 0) return nivelExaustao(actor);

  await ActiveEffect.implementation.create({
    name: loc("PYRO.Exaustao.Nome"),
    img: PYRO.condicoes.exausto?.img ?? "icons/svg/sleep.svg",
    origin: actor.uuid,
    statuses: ["exausto"],
    description: loc("PYRO.Exaustao.Dica"),
    flags: flagsDoSistema({ exaustao: delta, acumulador: true })
  }, { parent: actor });
  return nivelExaustao(actor);
}

/**
 * Sobrepeso vale +1 de exaustão de verdade, no efeito, e não por baixo dos
 * panos: entrar em sobrepeso soma 1, sair tira 1. A flag no ator lembra se
 * o +1 já foi dado, então a conta nunca repete — e é gravada antes de mexer
 * no efeito, porque mexer no efeito dispara esta função de novo.
 */
export async function sincronizarSobrepeso(actor) {
  if (!actor) return;
  const agora = !!actor.system?.sobrepeso;
  const marcado = !!actor.getFlag(SYSTEM_ID, "sobrepesoExausto");
  if (agora === marcado) return;
  await actor.setFlag(SYSTEM_ID, "sobrepesoExausto", agora);
  await aplicarExaustao(actor, agora ? 1 : -1);
}

/**
 * Ensanguentado e Machucado (SRD Atributos): abaixo da metade e abaixo de um
 * quarto da vida. São estado, não efeito com regra própria, então acompanham
 * o PV sozinhos — e só a condição posta aqui é retirada, para não apagar uma
 * que o mestre tenha aplicado à mão.
 */
export async function sincronizarEstadoDeVida(actor) {
  if (!actor?.system?.limiaresPv) return;
  const estados = { ensanguentado: !!actor.system.ensanguentado, machucado: !!actor.system.machucado };
  for (const [chave, deveEstar] of Object.entries(estados)) {
    const nosso = actor.effects?.find?.(e => flagsDe(e)?.estadoDeVida === chave);
    if (deveEstar === !!nosso) continue;
    if (deveEstar) {
      await ActiveEffect.implementation.create({
        name: game.i18n.localize(PYRO.condicoes[chave].label),
        img: PYRO.condicoes[chave].img,
        origin: actor.uuid,
        statuses: [chave],
        flags: flagsDoSistema({ estadoDeVida: chave })
      }, { parent: actor });
    } else await nosso.delete();
  }
}

/**
 * Desmaio por exaustão (SRD Atributos): com exaustão igual ou maior que o
 * VIG o personagem apaga, e acorda quando ela cai abaixo de novo.
 *
 * O efeito posto aqui é assinado na flag, e só ele é removido quando a
 * exaustão baixa — um Desmaiado que o mestre aplicou pelo HUD do token por
 * outro motivo continua onde está.
 */
export async function sincronizarDesmaio(actor) {
  if (!actor) return;
  const vig = actor.system?.atributos?.vig?.total;
  if (!vig) return;
  const deveEstar = nivelExaustao(actor) >= vig;
  const nosso = actor.effects?.find?.(e => flagsDe(e)?.desmaioPorExaustao);
  if (deveEstar === !!nosso) return;

  if (deveEstar) {
    await ActiveEffect.implementation.create({
      name: game.i18n.localize("PYRO.Exaustao.Desmaio"),
      img: PYRO.condicoes.desmaiado?.img ?? "icons/svg/unconscious.svg",
      origin: actor.uuid,
      statuses: ["desmaiado"],
      description: game.i18n.localize("PYRO.Exaustao.DesmaioDica"),
      flags: flagsDoSistema({ desmaioPorExaustao: true })
    }, { parent: actor });
    return;
  }
  await nosso.delete();
}
