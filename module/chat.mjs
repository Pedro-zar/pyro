/**
 * Chat do PYRO: menu de contexto das mensagens e o rodapé dos cards do
 * sistema — fichas de dano por tipo e botões de aplicar dano/cura direto no
 * card. O menu de contexto continua existindo (metade, dobro, mental...),
 * mas o caminho principal está visível no próprio card.
 */

import { dadosDoEfeitoAplicado, variaveisDaMensagem } from "./efeitos.mjs";

/** Atores alvo da aplicação: tokens selecionados, ou o personagem do usuário. */
function alvos() {
  const selecionados = canvas.tokens?.controlled?.map(t => t.actor).filter(Boolean) ?? [];
  if (selecionados.length) return selecionados;
  return game.user.character ? [game.user.character] : [];
}

/** Mensagem a partir do elemento da lista (aceita HTMLElement ou jQuery). */
function mensagemDe(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.dataset?.messageId ?? li?.data?.("messageId");
  return game.messages.get(id);
}

/**
 * Totais da mensagem. Cards do sistema gravam o dano separado por tipo (pra
 * defesa ser descontada parcela a parcela) e a cura à parte. Mensagens simples
 * caem na soma das rolagens, sem tipo — nesse caso não há defesa a aplicar.
 */
function totais(message) {
  const flags = message?.flags?.pyro;
  if (flags?.danos || flags?.cura !== undefined) {
    return { danos: flags.danos ?? [], cura: flags.cura ?? 0 };
  }
  // Card antigo, de antes da separação por tipo.
  if (flags?.dano !== undefined) {
    return { danos: [{ tipo: "", total: flags.dano }], cura: flags.cura ?? 0 };
  }
  const soma = (message?.rolls ?? []).reduce((t, r) => t + (r.total ?? 0), 0);
  return { danos: [{ tipo: "", total: soma }], cura: soma };
}

function temRolagem(li) {
  const msg = mensagemDe(li);
  return !!msg && ((msg.rolls?.length > 0) || !!msg.flags?.pyro);
}

/** Aplica em todos os alvos e resume num único aviso. */
async function aplicarEm(msg, tipo, multiplicador = 1) {
  if (!msg) return;
  const t = totais(msg);
  const destinos = alvos();

  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  const resumos = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    const somaBruta = t.danos.reduce((soma, d) => soma + d.total, 0);
    if (tipo === "cura") resumos.push(await actor.aplicarCura(t.cura * multiplicador));
    else if (tipo === "estamina") resumos.push(await actor.aplicarEstamina(somaBruta * multiplicador));
    else if (tipo === "mental") resumos.push(await actor.aplicarDano(t.danos, { multiplicador, mental: true }));
    else if (tipo === "cheio") resumos.push(await actor.aplicarDano(t.danos, { multiplicador, ignorarDefesa: true }));
    else resumos.push(await actor.aplicarDano(t.danos, { multiplicador }));
  }
  if (resumos.length) ui.notifications.info(resumos.join(" · "));
}

async function aplicar(li, tipo, multiplicador = 1) {
  return aplicarEm(mensagemDe(li), tipo, multiplicador);
}

/** Itens do menu, na ordem em que aparecem. */
function opcoes() {
  return [
    {
      name: "PYRO.Chat.AplicarDano",
      icon: '<i class="fa-solid fa-heart-crack"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 1)
    },
    {
      name: "PYRO.Chat.AplicarMetade",
      icon: '<i class="fa-solid fa-heart-crack"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 0.5)
    },
    {
      name: "PYRO.Chat.AplicarDobro",
      icon: '<i class="fa-solid fa-burst"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 2)
    },
    {
      name: "PYRO.Chat.AplicarCheio",
      icon: '<i class="fa-solid fa-shield-slash"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "cheio", 1)
    },
    {
      name: "PYRO.Chat.AplicarMental",
      icon: '<i class="fa-solid fa-brain"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "mental", 1)
    },
    {
      name: "PYRO.Chat.AplicarCura",
      icon: '<i class="fa-solid fa-heart"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "cura", 1)
    },
    {
      name: "PYRO.Chat.AplicarEstamina",
      icon: '<i class="fa-solid fa-wind"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "estamina", 1)
    }
  ];
}

/* -------------------------------------------------------------------------- */
/*  Rodapé dos cards: fichas de dano por tipo + botões de aplicar             */
/* -------------------------------------------------------------------------- */

/**
 * Monta e injeta o rodapé nos cards do sistema (mensagens com flags.pyro).
 * As fichas somam o dano por tipo, com a cor do tipo; os botões aplicam nos
 * tokens selecionados, igual ao menu de contexto.
 */
function injetarRodape(message, element) {
  const flags = message.flags?.pyro;
  if (!flags) return;
  const danos = flags.danos ?? [];
  const cura = flags.cura ?? 0;
  if (!danos.length && !cura) return;

  const loc = k => game.i18n.localize(k);
  const esc = s => Handlebars.escapeExpression(s ?? "");

  // Rolagem genérica (habilidade/feitiço sem tipo): um valor só, que pode
  // virar dano, cura ou estamina — sem ficha duplicada.
  const generico = danos.length === 1 && !danos[0].tipo && cura === danos[0].total;

  /* --- Fichas por tipo --------------------------------------------------- */
  const porTipo = new Map();
  for (const d of danos) {
    const chave = d.tipo || "simples";
    porTipo.set(chave, (porTipo.get(chave) ?? 0) + d.total);
  }
  const fichas = [...porTipo.entries()].map(([tipo, total]) => {
    const label = tipo !== "simples"
      ? esc(loc(CONFIG.PYRO.tiposDano[tipo]?.label ?? tipo)) : "";
    return `<span class="ficha-dano dano-${tipo}"><strong>${total}</strong>${label ? ` ${label}` : ""}</span>`;
  });
  if (cura && !generico) {
    fichas.push(`<span class="ficha-dano dano-cura"><strong>${cura}</strong> ${loc("PYRO.Chat.CuraChip")}</span>`);
  }

  /* --- Botões ------------------------------------------------------------ */
  const bot = (modo, mult, titulo, conteudo) =>
    `<button type="button" class="pyro-aplicar" data-modo="${modo}" data-mult="${mult}"
             title="${loc(titulo)}">${conteudo}</button>`;
  const botoes = [];
  if (danos.length) {
    botoes.push(bot("dano", 1, "PYRO.Chat.AplicarDano",
      `<i class="fa-solid fa-heart-crack"></i> ${loc("PYRO.Chat.BotAplicar")}`));
    botoes.push(bot("dano", 0.5, "PYRO.Chat.AplicarMetade", "&frac12;"));
    botoes.push(bot("dano", 2, "PYRO.Chat.AplicarDobro", "2&times;"));
    if (!generico) {
      botoes.push(bot("cheio", 1, "PYRO.Chat.AplicarCheio", '<i class="fa-solid fa-shield-slash"></i>'));
    }
  }
  if (cura) {
    botoes.push(bot("cura", 1, "PYRO.Chat.AplicarCura",
      `<i class="fa-solid fa-heart"></i> ${loc("PYRO.Chat.BotCurar")}`));
    botoes.push(bot("estamina", 1, "PYRO.Chat.AplicarEstamina", '<i class="fa-solid fa-wind"></i>'));
  }

  const rodape = document.createElement("footer");
  rodape.className = "pyro-chat pyro-rodape-card";
  rodape.innerHTML = `
    <div class="pyro-fichas-dano">${fichas.join("")}</div>
    <div class="pyro-acoes-card">${botoes.join("")}</div>`;
  element.querySelector(".message-content")?.appendChild(rodape);

  rodape.querySelectorAll(".pyro-aplicar").forEach(b =>
    b.addEventListener("click", () =>
      aplicarEm(message, b.dataset.modo, Number(b.dataset.mult) || 1)));
}

export function registrarMenuChat() {
  // v13 usa getChatMessageContextOptions; o nome antigo fica como rede de
  // segurança caso a interface de chat legada esteja em uso.
  Hooks.on("getChatMessageContextOptions", (html, options) => options.push(...opcoes()));
  Hooks.on("getChatLogEntryContext", (html, options) => options.push(...opcoes()));

  Hooks.on("renderChatMessageHTML", (message, element) => {
    // Botões de efeito de uso nos cards: quem clica escolhe em quem aplicar.
    for (const botao of element.querySelectorAll(".pyro-aplicar-efeito")) {
      botao.addEventListener("click", () => aplicarEfeito(botao.dataset.efeitoUuid, message));
    }
    injetarRodape(message, element);
  });
}

/**
 * Copia o efeito do item para os atores alvo. Sem token selecionado, cai no
 * personagem do usuário — muitos efeitos de uso são no próprio conjurador.
 * As @variáveis daquele card (alcance, intenção, dano rolado) são resolvidas
 * agora, então a mesma magia conjurada com Intenção 3 entrega um efeito
 * diferente do que ela entregou com Intenção 1.
 */
async function aplicarEfeito(uuid, message = null) {
  const efeito = await fromUuid(uuid);
  if (!efeito) return ui.notifications.warn(game.i18n.localize("PYRO.Efeitos.NaoEncontrado"));

  const destinos = alvos();
  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  const vars = variaveisDaMensagem(message);
  const nomes = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    await ActiveEffect.implementation.create(
      dadosDoEfeitoAplicado(efeito, vars), { parent: actor }
    );
    nomes.push(actor.name);
  }

  if (nomes.length) {
    ui.notifications.info(game.i18n.format("PYRO.Efeitos.Aplicado", {
      efeito: efeito.name, alvos: nomes.join(", ")
    }));
  }
}
