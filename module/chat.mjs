/**
 * Menu de contexto das mensagens de chat: aplica dano, cura ou estamina nos
 * tokens selecionados (ou no personagem do jogador, se nada estiver selecionado).
 */

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
async function aplicar(li, tipo, multiplicador = 1) {
  const msg = mensagemDe(li);
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

export function registrarMenuChat() {
  // v13 usa getChatMessageContextOptions; o nome antigo fica como rede de
  // segurança caso a interface de chat legada esteja em uso.
  Hooks.on("getChatMessageContextOptions", (html, options) => options.push(...opcoes()));
  Hooks.on("getChatLogEntryContext", (html, options) => options.push(...opcoes()));

  // Botões de efeito de uso nos cards: quem clica escolhe em quem aplicar.
  Hooks.on("renderChatMessageHTML", (message, element) => {
    for (const botao of element.querySelectorAll(".pyro-aplicar-efeito")) {
      botao.addEventListener("click", () => aplicarEfeito(botao.dataset.efeitoUuid));
    }
  });
}

/**
 * Copia o efeito do item para os atores alvo. Sem token selecionado, cai no
 * personagem do usuário — muitos efeitos de uso são no próprio conjurador.
 */
async function aplicarEfeito(uuid) {
  const efeito = await fromUuid(uuid);
  if (!efeito) return ui.notifications.warn(game.i18n.localize("PYRO.Efeitos.NaoEncontrado"));

  const destinos = alvos();
  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  const nomes = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    // Cópia independente: alterar o item depois não mexe em quem já recebeu.
    const dados = efeito.toObject();
    delete dados._id;
    dados.origin = efeito.uuid;
    dados.transfer = false;
    dados.disabled = false;
    await ActiveEffect.implementation.create(dados, { parent: actor });
    nomes.push(actor.name);
  }

  if (nomes.length) {
    ui.notifications.info(game.i18n.format("PYRO.Efeitos.Aplicado", {
      efeito: efeito.name, alvos: nomes.join(", ")
    }));
  }
}
