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
 * Efeito de uma postura que não é a postura ativa do dono. O mesmo portão do
 * PyroActiveEffect, para o que o sistema lê por fora do core (bônus de dano,
 * custos, atributos presos a item): sem ele, a guarda desligada seguiria
 * dando o desconto dela.
 */
const dePosturaInativa = efeito => {
  const item = efeito.parent;
  if (!(item instanceof Item) || !item.system?.ehPostura) return false;
  return item.actor?.getFlag(SYSTEM_ID, "postura") !== item.id;
};

function efeitosAtivos(actor) {
  const lista = [];
  for (const efeito of actor?.allApplicableEffects?.() ?? []) {
    // `disabled` é escolha do jogador. Efeito preso a item aparece aqui de
    // propósito: ele está suprimido na ficha, mas vale na rolagem certa. Já
    // o de postura fora da postura não vale em canto nenhum.
    if (!efeito.disabled && !dePosturaInativa(efeito)) lista.push(efeito);
  }
  return lista;
}

/**
 * Rolagens de dano que os efeitos somam a este item. A fórmula aceita dado,
 * número plano ou os dois ("2d6", "2", "2d6+2", "2d6+1d4").
 */
/**
 * O efeito vale para algum destes itens? Uma técnica golpeia COM uma arma,
 * então o dano extra preso à katana entra também na técnica que a usa —
 * quem chama passa [tecnica, arma] e o efeito vale se casar com qualquer um.
 */
const valeParaAlgum = (efeito, itens) =>
  itens.some(i => efeitoValeParaItem(efeito, i));

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
        formula: resolverValorEfeito(dano.formula, varsDoEfeito(efeito)),
        nome: efeito.name
      });
    }
  }
  return saida;
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
 * Quanto os efeitos somam ou tiram do custo de usar este item. Chaves são as
 * de PYRO.alvosEfeito.custo: acoes, mana, estamina, energia.
 *
 * Diferente do bônus de dano, aqui não há fórmula: é um número com sinal, e a
 * conta é sempre soma. "Metade do custo" pediria uma regra de ordem entre
 * efeitos que não vale a complexidade enquanto ninguém precisar.
 */
export function ajustesDeCusto(actor, item) {
  const itens = (Array.isArray(item) ? item : [item]).filter(Boolean);
  const ajustes = {};
  for (const efeito of efeitosAtivos(actor)) {
    if (!valeParaAlgum(efeito, itens)) continue;
    for (const custo of flagsDe(efeito)?.custos ?? []) {
      const valor = Number(resolverValorEfeito(custo.valor, varsDoEfeito(efeito)));
      if (custo.chave && Number.isFinite(valor)) {
        ajustes[custo.chave] = (ajustes[custo.chave] ?? 0) + valor;
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
    if (sys.reducaoMana) ajustes.mana = (ajustes.mana ?? 0) - sys.reducaoMana;
  }
  return ajustes;
}

/**
 * Custo já ajustado. Reduções diferentes acumulam (os deltas chegam aqui já
 * somados), mas nunca zeram um custo que existia: o piso é 1. Um custo que
 * já era zero segue zero — não há o que reduzir — e ajuste que encarece
 * continua livre.
 */
export function custoAjustado(base, delta) {
  const b = Math.round(base ?? 0);
  const total = Math.max(0, Math.round(b + (delta ?? 0)));
  return (delta ?? 0) < 0 && b > 0 ? Math.max(1, total) : total;
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
      if (!flagsDe(efeito)?.deUso || efeito.disabled) continue;
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
  if (Number.isFinite(valor) && valor > 0) {
    const resolvido = dadosDePrazo(valor, unidade);
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

  const existente = actor.effects?.find?.(e => ehExaustao(e) && !e.disabled);
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
    flags: flagsDoSistema({ exaustao: delta })
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
