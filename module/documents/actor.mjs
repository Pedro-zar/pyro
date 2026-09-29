/**
 * Documento de ator: token inicial, testes de atributo e reação, pagamento
 * de recursos, dano/cura vindos do chat e recuperação por passagem de tempo.
 */
import { PYRO } from "../config.mjs";
import {
  formulaTeste, formulaReacao, prepararFormula, poolDoAtributo, calcularFormula
} from "../dados.mjs";
import {
  classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse, bonusPorNivel, ndAjustado,
  classeMaisDificil
} from "../progressao.mjs";
import {
  sincronizarSobrepeso, sincronizarDesmaio, sincronizarEstadoDeVida, aplicarExaustao,
  dadosDoEfeitoAplicado
} from "../efeitos.mjs";
import { formularioDoAtor, esc } from "../ui.mjs";
import {
  custoDeFriagem, dadosDeMolhado, reduzirCondicao, pilhasDe,
  regraMental, barradoPorMental, dicaMental, dicaMentais
} from "../condicoes.mjs";
import {
  campoCheckbox, campoNumero, campoSelect, camposDeTeste, aplicarExaustaoNoTeste,
  aplicarVontadeNoTeste, valorComInspiracao, htmlVontadeGasta, sufixoND,
  periciaDeSobrecarga, ajudaDaPericia, textoDoND, ehPericiaDeRegra
} from "../teste.mjs";
import { htmlFalhaAutomatica, htmlResultadoND, htmlBotaoSorte } from "../chat.mjs";
import { SYSTEM_ID, flagsDe, flagsDoSistema, formasAtivas, naFila } from "../sistema.mjs";
import {
  aparenciaDasFormas, intervaloDaManutencao, custoDaManutencao, cobrancasDaManutencao,
  cobrancasPagaveis, textoDaManutencao, nomeDoRecurso
} from "../transformacao.mjs";
import {
  dadosDePrazo, UNIDADE_PADRAO, contaEmTurnos, daUnidade, turnosDe
} from "../duracao.mjs";
import { donosDe, temDonoJogador } from "../tecnica.mjs";
import { multRecuperacaoDoAtor, comDensidade } from "../regioes.mjs";
import {
  camposDeDanoRecebido, ligarCamposDeDano, lerDanoRecebido, htmlContaDoDano, htmlDanoRestante
} from "../reacao.mjs";
import {
  economiaDoAtor, pontosDoCusto, textoDeAcoes, textoDoPagamento, anunciarAcao, dividirGasto
} from "../economia.mjs";

export class PyroActor extends Actor {
  /**
   * Personagens nascem com o token vinculado à ficha: arrastar a ficha pro
   * mapa já traz PV, mana e recursos calculados, e o dano aplicado no token
   * vale pra ficha inteira. NPCs seguem desvinculados, pra cada cópia do
   * mesmo inimigo ter a própria vida.
   */
  async _preCreate(data, options, user) {
    const permitido = await super._preCreate(data, options, user);
    if (permitido === false) return false;
    if (data.prototypeToken?.actorLink !== undefined) return;

    const personagem = this.type === "personagem";
    const escala = PYRO.escalaTamanho(this.system.tamanho, this.system.tamanhoExato);
    this.updateSource({
      prototypeToken: {
        ...PyroActor.formaDoToken(escala),
        // Ficha nova já nasce assinada, então a primeira troca de tamanho
        // dela redesenha o token normalmente.
        flags: flagsDoSistema({ tamanho: this.system.tamanhoExato
          ? `${this.system.tamanho}:${this.system.tamanhoExato}` : this.system.tamanho }),
        actorLink: personagem,
        disposition: personagem
          ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
          : CONST.TOKEN_DISPOSITIONS.HOSTILE,
        sight: { enabled: personagem }
      }
    });
  }

  /*
   * Sobrepeso e desmaio por exaustão são derivados — o primeiro da carga
   * contra a capacidade, o segundo da exaustão contra o VIG —, e quase
   * qualquer mudança pode virá-los: FOR ou VIG mudou, item entrou, saiu ou
   * foi equipado, um efeito mexeu na carga ou na exaustão. Depois de cada
   * mudança os dois são acertados, só no cliente de quem editou, senão cada
   * um repetiria a conta.
   *
   * O sobrepeso vem primeiro porque ele mesmo soma exaustão, e é essa
   * exaustão que o desmaio precisa enxergar.
   */
  async #acertarDerivados(userId) {
    if (game.user.id !== userId) return;
    /*
     * Uma sincronização por vez, em fila. Os hooks que chamam esta função são
     * síncronos e ela cria efeitos, o que dispara os mesmos hooks antes do
     * `create` de fora terminar: sem a fila, duas execuções conferem "já
     * existe?" ao mesmo tempo, as duas veem que não, e o personagem fica com
     * dois Machucados. A fila é por ator, e o `catch` existe para um erro numa
     * passagem não travar todas as seguintes.
     */
    this.#filaDerivados = this.#filaDerivados
      .catch(() => {})
      .then(async () => {
        await sincronizarSobrepeso(this);
        await sincronizarDesmaio(this);
        await sincronizarEstadoDeVida(this);
      });
    return this.#filaDerivados;
  }

  #filaDerivados = Promise.resolve();

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    this.#acertarDerivados(userId);
  }

  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    this.#acertarDerivados(userId);
  }

  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    this.#acertarDerivados(userId);
  }

  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    this.#acertarDerivados(userId);
  }

  /**
   * @for, @vig... = o atributo em jogo (base mais efeitos). @dados.for = fórmula da pool
   * (string, inline na Roll — é assim que a iniciativa "@dados.agi" funciona).
   */
  getRollData() {
    const data = { ...super.getRollData() };
    data.dados = {};
    for (const [chave, attr] of Object.entries(this.system.atributos ?? {})) {
      data[chave] = attr.total;
      data.dados[chave] = attr.pool;
    }
    data.det = this.system.det;
    data.multi = this.system.multi;
    // [NVL] é nível de item. Numa rolagem do ator não há item nenhum, e sem
    // esta linha a fórmula copiada de uma habilidade quebraria em vez de
    // simplesmente não somar nada.
    data.nvl = 0;
    return data;
  }

  /**
   * Reage a uma mudança de tamanho da criatura: o token passa a ocupar o
   * espaço novo e o PV acompanha em proporção — quem estava com 3 de 7 vira
   * 6 de 14, e não 3 de 14. Roda pelos hooks de ator, item e efeito, porque
   * o tamanho pode vir de qualquer um dos três.
   *
   * Quem decide se há o que fazer é a marca gravada no prototypeToken, e não
   * a largura dele. A diferença importa: mudar a tabela de tamanhos não sai
   * redesenhando token que ninguém pediu para mudar — quem já estava Enorme
   * continua no desenho antigo até o tamanho mudar de verdade. Ficha que nunca
   * viu a marca adota o estado atual sem mexer em nada.
   */
  async aplicarMudancaDeTamanho() {
    const marca = PyroActor.#marcaDeTamanho(this.system);
    const anterior = this.prototypeToken.getFlag(SYSTEM_ID, "tamanho");
    if (anterior === marca) return;
    // Um cliente só faz a atualização, senão todos disparam a mesma coisa.
    if (!(game.users.activeGM?.isSelf ?? game.user.isGM)) return;

    const mudancas = { [`prototypeToken.flags.${SYSTEM_ID}.tamanho`]: marca };
    const escala = this.system.escalaTamanho;
    const larguraAntiga = this.prototypeToken.width;

    // Primeira vez: só assina o estado de hoje, sem redesenhar nem recalcular.
    if (anterior !== undefined) {
      if (escala !== larguraAntiga) {
        for (const [k, v] of Object.entries(PyroActor.formaDoToken(escala))) {
          mudancas[`prototypeToken.${k}`] = v;
        }
      }
      const razao = PYRO.razaoVida(PyroActor.#tamanhoDaMarca(anterior), this.system.tamanho);
      if (razao !== 1) {
        const pv = this.system.recursos.pv;
        mudancas["system.recursos.pv.value"] = Math.max(0, Math.round(pv.value * razao));
      }
    }

    await this.update(mudancas);
    if (anterior === undefined || escala === larguraAntiga) return;

    // Tokens já postos no mapa: só os que ainda estavam no tamanho anterior,
    // para não desfazer um ajuste manual do mestre.
    for (const cena of game.scenes) {
      const alvos = cena.tokens.filter(t =>
        t.actorId === this.id && t.width === larguraAntiga && t.height === larguraAntiga
      );
      if (alvos.length) {
        await cena.updateEmbeddedDocuments("Token",
          alvos.map(t => ({ _id: t.id, ...PyroActor.formaDoToken(escala) })));
      }
    }
  }

  /**
   * O que o token precisa para ocupar `escala` espaços.
   *
   * Em grid hexagonal o Foundry tem forma própria para token de 2, 3 e 4
   * espaços — a elipse variante 2 é a que esta mesa usa. Acima de 4 só existe
   * o bloco, que já é o padrão, e em grid quadrado a forma é ignorada.
   */
  static formaDoToken(escala) {
    const dados = { width: escala, height: escala };
    const formas = CONST.TOKEN_HEXAGONAL_SHAPES;
    if (!formas) return dados;
    return { ...dados, hexagonalShape: [2, 3, 4].includes(escala) ? formas.ELLIPSE_2 : formas.ELLIPSE_1 };
  }

  /**
   * Assinatura do tamanho, na forma "gigante" ou "colossal:24". O número
   * exato entra porque mudar só ele (colossal 20 para 24) também redesenha
   * o token, sem trocar de degrau.
   */
  static #marcaDeTamanho(sys) {
    return sys.tamanhoExato ? `${sys.tamanho}:${sys.tamanhoExato}` : sys.tamanho;
  }

  /** O degrau de uma marca, ignorando o número exato. */
  static #tamanhoDaMarca(marca) {
    return String(marca ?? "").split(":")[0];
  }

  /* ---------------------------------------------------------------------- */
  /*  Testes de atributo                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Teste de atributo com diálogo (bônus, vantagem/desvantagem, ND).
   * `rapido` pula o diálogo.
   */
  async rolarAtributo(chave, { rapido = false } = {}) {
    const attr = this.system.atributos?.[chave];
    if (!attr) return;
    const label = game.i18n.localize(PYRO.atributos[chave]);

    let opts = { bonus: 0, vantagem: 0, desvantagem: 0, nd: null };
    if (!rapido) {
      const res = await formularioDoAtor(this, {
        titulo: game.i18n.format("PYRO.Teste.Titulo", { atributo: label }),
        conteudo: camposDeTeste(this, { dica: dicaMental(this, chave) })
      });
      if (!res) return;
      opts = { ...opts, ...res, nd: res.nd || null };
    }
    aplicarExaustaoNoTeste(this, opts, chave);

    const valorBase = attr.total;

    /*
     * A classe da rolagem é medida antes da Força de Vontade entrar: por
     * regra ela fica fora dessa conta (SRD 3b), senão gastar pontos num teste
     * o rebaixaria de difícil para rotineiro e ele deixaria de contar para o
     * avanço — exatamente ao contrário do que o gasto significa.
     */
    const classe = opts.nd
      ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(valorBase), opts), nd: Number(opts.nd) })
      : null;

    const vontade = await aplicarVontadeNoTeste(this, opts);
    opts.vantagem += vontade.beneficio;
    const valor = valorComInspiracao(valorBase, vontade);
    const formula = formulaTeste(valor, opts);
    const flavor = game.i18n.format("PYRO.Chat.TesteDe", { atributo: label }) + sufixoND(opts.nd);
    const extra = htmlVontadeGasta(vontade);
    if (formula === null) return this.#falhaAutomatica(flavor, extra);

    const roll = await new Roll(formula).evaluate();
    let content = "";
    if (classe) {
      content = htmlResultadoND(roll.total >= Number(opts.nd)) + htmlClasseDaRolagem(classe);
    }
    content += extra;
    return this.#cardDeTeste(roll, { flavor, html: content, flags: classe ? flagsDaClasse(classe) : null });
  }


  /* ---------------------------------------------------------------------- */
  /*  Perícias                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Teste de perícia (SRD 3b): o jogador escolhe o atributo entre os que a
   * perícia aceita; o nível soma +1 e +1 vantagem a cada 5; sem treino e sem
   * ferramentas o ND acima de 10 dobra. A classe da rolagem é medida contra o
   * ND original, com a pool já com os bônus da perícia.
   * @param {Item} pericia
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.ajudar] só calcula a ajuda a um aliado, sem rolar.
   */
  async rolarPericia(pericia, { ajudar = false } = {}) {
    /*
     * Sobrecarga e Mirar são perícias com regra própria, e cada uma tem a
     * janela dela — com o preço da falha, com a distância do alvo. Abertas na
     * ficha elas caem na mesma janela do botão do chat, em vez do diálogo
     * genérico, que não teria onde pedir esses números.
     *
     * Ajudar continua sendo o diálogo comum: emprestar treino a um aliado é a
     * mesma coisa em qualquer perícia, e não rola nada.
     */
    if (!ajudar) {
      if (ehPericiaDeRegra(pericia, PYRO.NOME_PERICIA_SOBRECARGA)) {
        return this.rolarSobrecarga({ pericia });
      }
      if (ehPericiaDeRegra(pericia, PYRO.NOME_PERICIA_MIRA)) {
        const { rolarMira } = await import("../mira.mjs");
        return rolarMira(this, { pericia });
      }
    }

    const sys = pericia.system;
    const nivel = sys.progresso.nivel;
    const porNivel = bonusPorNivel(nivel);
    const loc = k => game.i18n.localize(k);

    const aceitos = sys.atributos.length ? sys.atributos : Object.keys(PYRO.atributos);
    const atributoOpts = Object.fromEntries(aceitos.map(k => [k, loc(PYRO.atributos[k])]));
    const dicaNivel = nivel
      ? game.i18n.format("PYRO.Pericia.DicaNivel", { nivel, bonus: porNivel.bonus, vantagens: porNivel.vantagens })
      : loc("PYRO.Pericia.DicaSemTreino");
    const extras = sys.exigeFerramentas ? campoCheckbox("semFerramentas", "PYRO.Pericia.SemFerramentas") : "";

    const res = await formularioDoAtor(this, {
      titulo: game.i18n.format(ajudar ? "PYRO.Pericia.TituloAjuda" : "PYRO.Pericia.Titulo", { nome: pericia.name }),
      // Ajudar não rola nada: sem campos de Força de Vontade, que ali não
      // teriam onde ser gastos.
      /*
       * A dica lista TODAS as condições mentais em curso, e não a de um
       * atributo: aqui o atributo é escolhido dentro da janela, e o jogador
       * precisa ver qual escolha custa um dado antes de escolher.
       */
      conteudo: campoSelect("atributo", "PYRO.Pericia.Atributo", atributoOpts, aceitos[0])
        + camposDeTeste(this, {
          dica: [dicaNivel, dicaMentais(this)].filter(Boolean).join(" "),
          extras, comVontade: !ajudar
        }),
      rotuloOk: ajudar ? "PYRO.Pericia.Ajudar" : "PYRO.Rolar"
    });
    if (!res) return;

    const chave = atributoOpts[res.atributo] ? res.atributo : aceitos[0];
    const attr = this.system.atributos[chave];
    const opts = { bonus: res.bonus, vantagem: res.vantagem, desvantagem: res.desvantagem };
    // O atributo da perícia é escolhido no diálogo, então a condição mental só
    // pode ser consultada aqui — depois de saber em que atributo se rolou.
    aplicarExaustaoNoTeste(this, opts, chave);
    opts.bonus += porNivel.bonus;
    opts.vantagem += porNivel.vantagens;

    const ndOriginal = Number(res.nd) || 0;
    const semFerramentas = sys.exigeFerramentas && !!res.semFerramentas;
    const nd = ndAjustado(ndOriginal, { semTreino: !sys.aprendida, semFerramentas });
    const classe = ndOriginal
      ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(attr.total), opts), nd: ndOriginal })
      : null;
    const rotuloAtributo = loc(PYRO.atributos[chave]);
    const ajustes = [
      !sys.aprendida ? loc("PYRO.Pericia.SemTreinoTag") : null,
      semFerramentas ? loc("PYRO.Pericia.SemFerramentasTag") : null
    ].filter(Boolean).join(", ");
    const textoND = textoDoND(ndOriginal, nd, ajustes);

    // Ajudar não rola nada, então também não gasta Força de Vontade.
    if (ajudar) {
      // O inseguro não consegue emprestar confiança a ninguém.
      if (barradoPorMental(this, "semAjudar")) return;
      return this.#cardDeAjuda(pericia, rotuloAtributo, porNivel, classe, textoND);
    }

    // Depois da classe, pelo mesmo motivo do teste de atributo: a Vontade
    // não entra na medida de dificuldade da rolagem.
    const vontade = await aplicarVontadeNoTeste(this, res);
    opts.vantagem += vontade.beneficio;

    const flavor = game.i18n.format("PYRO.Pericia.TesteDe", { nome: pericia.name, atributo: rotuloAtributo }) + textoND;
    const formula = formulaTeste(valorComInspiracao(attr.total, vontade),
      { ...opts, explode: sys.contaSoSucesso });
    if (formula === null) return this.#falhaAutomatica(flavor, htmlVontadeGasta(vontade));

    const roll = await new Roll(formula).evaluate();
    let content = "";
    if (ndOriginal) {
      const sucesso = roll.total >= nd;
      // Percepção só progride com sucesso: sem ele, a classe aparece mas o botão não.
      const conta = !sys.contaSoSucesso || sucesso;
      content = htmlResultadoND(sucesso) + htmlClasseDaRolagem(classe, conta ? pericia : null);
    }
    content += htmlVontadeGasta(vontade);
    return this.#cardDeTeste(roll, { flavor, html: content, flags: classe ? flagsDaClasse(classe, pericia) : null });
  }

  /**
   * Teste de sobrecarga (SRD Magia e Técnicas), aberto pelo botão do card da
   * conjuração ou da execução: quem passou do limite escolhe quando encarar o
   * dado, e aqui ele ainda pode gastar Força de Vontade. A perícia Sobrecarga
   * clicada na ficha abre esta mesma janela — é dela que sai o preço da falha,
   * e o diálogo genérico de perícia não teria onde pedir esse número.
   *
   * É um teste de perícia como qualquer outro: se o personagem tiver a
   * perícia "Sobrecarga", ela entra com o bônus e as vantagens do nível dela;
   * se não tiver, vale a regra do sem treino e o ND dobra acima de 10. O
   * atributo é o da regra que chamou (SAB na magia, VIG na técnica), e só se
   * escolhe quando não houve regra nenhuma.
   *
   * @param {number} [opcoes.nd] dificuldade vinda do card.
   * @param {number} [opcoes.exaustao] exaustão que a falha custa.
   * @param {string} [opcoes.atributo] chave do atributo do teste. Sem ela —
   *   é o caso da perícia aberta na ficha, sem regra nenhuma por trás —, a
   *   janela pergunta, entre os atributos que a perícia aceita.
   * @param {Item} [opcoes.pericia] a perícia, quando quem abriu foi ela.
   * @param {number} [opcoes.bonusAtributo] o que um efeito preso ao item soma
   *   ao ATRIBUTO ("+2 VIG com a katana") — entra na pool, como em toda
   *   rolagem do sistema, e não como um somatório plano no total.
   * @param {string} [opcoes.itemUuid] magia ou técnica que gerou a sobrecarga.
   * @returns {Promise<boolean>} false quando o diálogo foi cancelado.
   */
  async rolarSobrecarga({ nd = 0, exaustao = 1, atributo = null, bonusAtributo = 0,
                          itemUuid = null, pericia: dePericia = null } = {}) {
    const loc = k => game.i18n.localize(k);
    // A perícia clicada manda; só quando a chamada veio de um card é que ela
    // é procurada pelo nome.
    const { pericia, aprendida, dica, bonus, vantagens } =
      ajudaDaPericia(dePericia ?? periciaDeSobrecarga(this));
    /*
     * A regra que chamou manda no atributo (SAB na magia, VIG na técnica).
     * Aberta pela ficha não há regra, então a escolha passa a ser de quem
     * rola, entre os atributos que a própria perícia aceita.
     */
    /*
     * VIG e SAB entram sempre: são os que a regra usa (técnica e magia), e a
     * perícia criada à mão pela mesa nasce só com o atributo padrão do
     * esquema, que deixaria de fora justamente os dois que importam.
     */
    const aceitos = [...new Set([
      ...(dePericia?.system?.atributos ?? Object.keys(PYRO.atributos)), "vig", "sab"
    ])];
    const escolher = !PYRO.atributos[atributo];
    const opcoesAtributo = Object.fromEntries(aceitos.map(k => [k, loc(PYRO.atributos[k])]));
    const padrao = PYRO.atributos[atributo] ? atributo
      : (aceitos.includes("vig") ? "vig" : aceitos[0]);
    const delta = Math.round(Number(bonusAtributo) || 0);

    const dicas = [
      dica || loc("PYRO.Sobrecarga.SemPericia"),
      // O ajuste de atributo só chega pela regra, junto do atributo fixo.
      delta ? game.i18n.format("PYRO.Sobrecarga.AtributoAjustado", {
        atributo: loc(PYRO.atributos[padrao]),
        valor: Math.max(1, this.system.atributos[padrao].total + delta),
        delta: delta > 0 ? `+${delta}` : delta
      }) : null,
      /*
       * Com o atributo escolhido dentro da janela, a dica lista TODAS as
       * condições mentais em curso: o jogador precisa ver qual escolha custa
       * um dado antes de escolher.
       */
      (escolher ? dicaMentais(this) : dicaMental(this, padrao)) || null
    ].filter(Boolean);

    const res = await formularioDoAtor(this, {
      titulo: loc("PYRO.Sobrecarga.Titulo"),
      conteudo: (escolher
        ? campoSelect("atributo", "PYRO.Pericia.Atributo", opcoesAtributo, padrao) : "")
        + camposDeTeste(this, {
          dica: dicas.join("<br>"),
          // Aberto pela ficha não há dificuldade nenhuma decidida: o campo
          // abre vazio, e um "0" escrito ali passaria por ND válido e faria o
          // teste sair sem sucesso, sem falha e sem exaustão.
          nd: Number(nd) || null,
          // Só o teste de sobrecarga tem este campo: é o preço da falha, e ele
          // fica editável porque a mesa às vezes negocia o que o excesso custa.
          extras: campoNumero("exaustao", "PYRO.Sobrecarga.ExaustaoAoFalhar",
            Math.max(0, Math.round(Number(exaustao) || 0)), 0)
            + (pericia?.system?.exigeFerramentas
              ? campoCheckbox("semFerramentas", "PYRO.Pericia.SemFerramentas") : "")
        }),
      rotuloOk: "PYRO.Rolar"
    });
    if (!res) return false;

    const chave = escolher && opcoesAtributo[res.atributo] ? res.atributo : padrao;
    const rotuloAtributo = loc(PYRO.atributos[chave]);
    const valorAtributo = Math.max(1, this.system.atributos[chave].total + delta);

    const opts = { bonus: res.bonus, vantagem: res.vantagem, desvantagem: res.desvantagem };
    aplicarExaustaoNoTeste(this, opts, chave);
    opts.bonus += bonus;
    opts.vantagem += vantagens;

    const ndOriginal = Number(res.nd) || 0;
    const semFerramentas = !!pericia?.system?.exigeFerramentas && !!res.semFerramentas;
    const ndFinal = ndAjustado(ndOriginal, { semTreino: !aprendida, semFerramentas });
    /*
     * A classe é medida antes da Força de Vontade, como em toda perícia — e
     * só existe quando há ND: apagar o campo é rolar por rolar, e uma
     * rolagem sem dificuldade não mede nada nem conta uso nenhum.
     */
    const classe = ndOriginal
      ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(valorAtributo), opts), nd: ndOriginal })
      : null;
    const textoND = textoDoND(ndOriginal, ndFinal);

    const vontade = await aplicarVontadeNoTeste(this, res);
    opts.vantagem += vontade.beneficio;

    const flavor = game.i18n.format("PYRO.Sobrecarga.Flavor", { atributo: rotuloAtributo }) + textoND;
    const formula = formulaTeste(valorComInspiracao(valorAtributo, vontade),
      { ...opts, explode: !!pericia?.system?.contaSoSucesso });
    const roll = formula === null ? null : await new Roll(formula).evaluate();
    const sucesso = !!roll && roll.total >= ndFinal;

    /*
     * A exaustão é cobrada aqui, e não no card da magia: o card diz o que
     * está em jogo, este teste é que decide. Pool zerada é falha automática
     * (SRD Atributos) e custa igual.
     */
    const niveis = Math.max(0, Math.round(Number(res.exaustao) || 0));
    // Sem rolagem o card já diz "falha automática": repetir "falhou" abaixo
    // seria a mesma notícia duas vezes.
    let html = roll && ndOriginal ? htmlResultadoND(sucesso) : "";
    if (ndOriginal && !sucesso && niveis > 0) {
      const total = await aplicarExaustao(this, niveis);
      html += `<p>${game.i18n.format("PYRO.Sobrecarga.Exaustao", { niveis, total })}</p>`;
    } else if (ndOriginal && sucesso) {
      html += `<p>${loc("PYRO.Sobrecarga.Resistiu")}</p>`;
    }
    /*
     * A mesma rolagem conta para dois: ela mede a dificuldade da magia ou da
     * técnica (SRD: "considere o teste de sobrecarga") e é um teste da
     * perícia que a fez.
     */
    const item = itemUuid ? await fromUuid(itemUuid) : null;
    // Perícia que só progride com sucesso não conta o uso numa falha.
    const contaPericia = !pericia?.system?.contaSoSucesso || sucesso;
    html += htmlClasseDaRolagem(classe, [item, contaPericia ? pericia : null], {
      /*
       * A magia que passou do limite foi, no mínimo, difícil: o teste de
       * sobrecarga pode sair rotineiro para quem tem a perícia treinada, mas
       * isso mede a perícia, e não o feitiço que forçou a mão de quem
       * conjurou. Muito difícil no teste continua muito difícil na magia.
       */
      classeDe: alvo => alvo === item && item?.type === "magia"
        ? classeMaisDificil(classe, "dificil") : classe
    });
    html += htmlVontadeGasta(vontade);

    if (!roll) {
      await this.#falhaAutomatica(flavor, html);
      return true;
    }
    await this.#cardDeTeste(roll, { flavor, html, flags: flagsDaClasse(classe, item) });
    return true;
  }

  /**
   * Ajudar (SRD §5): 1 vantagem ao aliado, mais 1 a cada 5 níveis da perícia.
   * O ajudante progride como se tivesse rolado, então o card traz a classe
   * da pool dele contra o ND e o botão de contar.
   */
  #cardDeAjuda(pericia, rotuloAtributo, porNivel, classe, textoND) {
    const vantagens = 1 + porNivel.vantagens;
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format("PYRO.Pericia.AjudaCom", { nome: pericia.name, atributo: rotuloAtributo }) + textoND,
      content: `<div class="pyro-chat">
        <p class="pyro-ajuda">${game.i18n.format("PYRO.Pericia.AjudaTexto", { vantagens })}</p>
        ${htmlClasseDaRolagem(classe, pericia)}
      </div>`,
      ...(classe ? { flags: flagsDoSistema(flagsDaClasse(classe, pericia)) } : {})
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Reações                                                               */
  /* ---------------------------------------------------------------------- */

  async rolarEsquiva(opcoes = {}) {
    return this.#rolarReacao("esquiva", opcoes);
  }

  async rolarBloqueio(opcoes = {}) {
    return this.#rolarReacao("bloqueio", opcoes);
  }

  /**
   * Esquiva e bloqueio são testes como os de atributo: mesma janela (bônus
   * fixo, vantagens, desvantagens, ND) mais a cobertura, que dobra os dados
   * (SRD §5), e a mesma exaustão descontando.
   * Vantagem e desvantagem mexem no dado da reação — d12 na esquiva, d4 no
   * bloqueio — e os dados que o equipamento soma ficam como estão.
   */
  async #rolarReacao(tipo, { cobertura = false } = {}) {
    if (!this.podeAgir()) return;
    // Insensato não se protege: sem cobertura, sem esquiva e sem bloqueio.
    if (barradoPorMental(this, "semReacoes")) return;
    const cfg = PYRO.reacoes[tipo];
    const chaves = tipo === "esquiva"
      ? { titulo: "PYRO.Esquivar", flavor: "PYRO.Chat.Esquiva", flavorCobertura: "PYRO.Chat.EsquivaCobertura" }
      : { titulo: "PYRO.Bloquear", flavor: "PYRO.Chat.Bloqueio", flavorCobertura: "PYRO.Chat.BloqueioCobertura" };

    /*
     * A janela abre sempre, mesmo com Shift: o dano que chega é obrigatório,
     * e sem ele não há ND nem como dizer se a reação deu certo.
     *
     * Sem Inspiração Divina: a pool da reação é fixa pelo sistema (d4 no
     * bloqueio, d12 na esquiva) e não sai de atributo nenhum, então não há
     * atributo para dobrar. No lugar do ND vem o dano, por tipo: o ND real é
     * o que sobra depois da defesa de cada tipo.
     */
    const res = await formularioDoAtor(this, {
      titulo: game.i18n.localize(chaves.titulo),
      conteudo: camposDeTeste(this, {
        dica: game.i18n.format("PYRO.Reacao.Base", { formula: this.system[tipo] || "0" }),
        extras: camposDeDanoRecebido() + campoCheckbox("cobertura", "PYRO.Reacao.Cobertura", cobertura),
        comInspiracao: false,
        comND: false
      }),
      aoRenderizar: ligarCamposDeDano
    });
    if (!res) return;
    const contaDoDano = lerDanoRecebido(res, this.system.defesas?.totais);
    // O campo já é obrigatório no formulário; isto cobre o que passar dele.
    if (!contaDoDano) return ui.notifications.warn(game.i18n.localize("PYRO.Reacao.SemDano"));
    const opts = {
      bonus: 0, vantagem: 0, desvantagem: 0, ...res,
      nd: contaDoDano.total,
      cobertura: !!res.cobertura
    };
    // Cobrado depois da janela: fechar o diálogo não pode levar a reação.
    const gasto = await this.gastarAcoes(1, { tipo: "reacao" });
    if (!gasto.ok) return;
    aplicarExaustaoNoTeste(this, opts);
    const vontade = await aplicarVontadeNoTeste(this, opts);
    opts.vantagem += vontade.beneficio;

    /*
     * Friagem cobra estamina de cada reação, o quadrado das pilhas (SRD
     * Magia). É cobrado aqui, e não lembrado ao jogador, porque uma reação
     * acontece no meio do turno de outra pessoa — é exatamente o momento em
     * que ninguém quer parar para conferir uma condição.
     */
    const friagem = custoDeFriagem(this);
    let pagoFriagem = null;
    if (friagem > 0) pagoFriagem = await this.pagarCustos({ estamina: friagem });

    const formula = formulaReacao(this.system[tipo], cfg.faces, opts);
    const flavor = game.i18n.localize(opts.cobertura ? chaves.flavorCobertura : chaves.flavor)
      + sufixoND(opts.nd) + (gasto.texto ? ` · ${gasto.texto}` : "");
    // Montado antes da saída por falha automática: a estamina já foi cobrada,
    // e uma reação que falha sem dizer o que custou parece um bug na mesa.
    const avisoFriagem = friagem > 0
      ? `<p class="pyro-nota"><i class="fa-solid fa-snowflake"></i>
          ${game.i18n.format("PYRO.Condicoes.FriagemCobrou", {
            valor: friagem, pilhas: pilhasDe(this, "friagem")
          })}${pagoFriagem?.dosPv
            ? ` ${game.i18n.format("PYRO.Chat.CustoPv", { valor: pagoFriagem.dosPv })}` : ""}</p>`
      : "";

    const conta = htmlContaDoDano(contaDoDano);
    if (formula === null) {
      return this.#falhaAutomatica(flavor, conta + htmlVontadeGasta(vontade) + avisoFriagem);
    }

    const dados = this.getRollData();
    const roll = await new Roll(prepararFormula(formula, dados), dados).evaluate();
    /*
     * A esquiva escapa de tudo ou de nada, e o card diz qual. O bloqueio
     * reduz: além de dizer se segurou tudo, diz quanto ainda passa.
     */
    const resultado = htmlResultadoND(roll.total >= contaDoDano.total)
      + (tipo === "bloqueio" ? htmlDanoRestante(contaDoDano.total, roll.total) : "");
    return this.#cardDeTeste(roll, {
      flavor,
      html: conta + resultado + avisoFriagem + htmlVontadeGasta(vontade)
    });
  }

  /**
   * Card de um teste: a rolagem renderizada e, abaixo dela, o resultado contra
   * o ND e a classe. Monta o conteúdo à mão porque `content` em toMessage
   * substituiria a rolagem em vez de acompanhá-la.
   */
  async #cardDeTeste(roll, { flavor, html = "", flags = null }) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      // A Sorte age sobre esta rolagem, então o botão dela mora no card.
      content: `<div class="pyro-chat pyro-teste">${await roll.render()}${html}${htmlBotaoSorte()}</div>`,
      rolls: [roll],
      sound: CONFIG.sounds.dice,
      ...(flags ? { flags: flagsDoSistema(flags) } : {})
    });
  }

  /** Pool reduzida a zero dados por desvantagem: falha sem rolar (SRD §6). */
  #falhaAutomatica(flavor, html = "") {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: htmlFalhaAutomatica() + html
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Força de Vontade                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Vontade de Viver (SRD Atributos): a 0 PV, por 2 pontos, o personagem se
   * agarra à própria vida e não cai. Recupera o suficiente para deixar de
   * estar Machucado, que é o limiar de um quarto da vida máxima — nem mais
   * que isso, porque a regra é sobreviver, não voltar inteiro.
   */
  async vontadeDeViver() {
    const recursos = this.system.recursos;
    if (recursos.pv.value > 0) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Vontade.ViverSoAZero"));
    }
    if (recursos.vontade.value < PYRO.CUSTO_VONTADE_DE_VIVER) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
    }
    const alvo = this.system.limiaresPv.machucado;
    await this.update({
      "system.recursos.vontade.value": recursos.vontade.value - PYRO.CUSTO_VONTADE_DE_VIVER,
      "system.recursos.pv.value": alvo
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="pyro-chat"><p class="pyro-vontade-viver">
        <strong>${game.i18n.localize("PYRO.Vontade.Viver")}</strong>
        ${game.i18n.format("PYRO.Vontade.ViverCard", { pv: alvo })}</p></div>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Estamina (com transbordo pra PV — SRD Recursos)                       */
  /* ---------------------------------------------------------------------- */

  /** Paga um custo de estamina; o que faltar sai dos PV. Retorna o que foi pago. */
  async pagarEstamina(custo) {
    const recursos = this.system.recursos;
    const daEstamina = Math.min(recursos.estamina.value, custo);
    const dosPv = custo - daEstamina;
    await this.update({
      "system.recursos.estamina.value": recursos.estamina.value - daEstamina,
      "system.recursos.pv.value": Math.max(0, recursos.pv.value - dosPv)
    });
    return { daEstamina, dosPv };
  }

  /**
   * Paga estamina, mana e energia de uma vez (habilidades).
   * Mana e energia não têm transbordo: sem o total, a habilidade não sai.
   * Retorna null se faltar recurso.
   */
  /**
   * Cobra custos em recursos: { estamina, mana, energia, energiaNatural... }.
   * Estamina é a única que transborda para PV quando falta (SRD Recursos);
   * qualquer outro recurso precisa existir na ficha e bastar, senão nada é
   * cobrado. Devolve o que saiu de cada um, ou null quando faltou.
   */
  async pagarCustos(cobra = {}) {
    const recursos = this.system.recursos;
    const { estamina = 0, ...resto } = cobra;

    const pagos = {};
    const update = {};
    for (const [chave, valor] of Object.entries(resto)) {
      if (!(valor > 0)) continue;
      const atual = recursos[chave]?.value ?? 0;
      if (valor > atual) {
        ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemRecurso", {
          recurso: game.i18n.localize(
            PYRO.recursosCustom?.[chave]?.label ?? `PYRO.Recursos.${chave}`),
          custo: valor, atual
        }));
        return null;
      }
      pagos[chave] = valor;
      update[`system.recursos.${chave}.value`] = atual - valor;
    }

    const daEstamina = Math.min(recursos.estamina.value, estamina);
    const dosPv = estamina - daEstamina;
    update["system.recursos.estamina.value"] = recursos.estamina.value - daEstamina;
    update["system.recursos.pv.value"] = Math.max(0, recursos.pv.value - dosPv);
    await this.update(update);
    return { daEstamina, dosPv, ...pagos };
  }

  /**
   * O personagem pode gastar ação ou reação agora?
   *
   * Carregando o dobro do que aguenta, não pode: a conta de ações e de reações
   * vira zero, e é isso que segura o ataque, a habilidade, a técnica, a magia,
   * o consumível e as duas reações. O aviso diz o motivo — sem ele o clique
   * pareceria um botão quebrado.
   *
   * Rolagem de perícia fica de fora: ela não é necessariamente uma ação de
   * combate, e travar um teste de Percepção porque a mochila está pesada seria
   * inventar regra.
   */
  podeAgir({ aviso = true } = {}) {
    if (!this.system?.imobilizado) return true;
    if (aviso) {
      ui.notifications.warn(game.i18n.format("PYRO.Alerta.SemAcoes", {
        atual: this.system.carga.atual, max: this.system.carga.max
      }));
    }
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /*  Contador de ações e reações (SRD §5)                                  */
  /* ---------------------------------------------------------------------- */

  /** O contador do turno agora (ver economiaDoAtor). */
  get economia() {
    return economiaDoAtor(this);
  }

  /**
   * O contador comporta este custo? Avisa quando não. Fora de combate
   * sempre comporta, porque ali nada é contado.
   * @param {number} n o custo escrito.
   * @param {string} [opcoes.tipo] "acao" ou "reacao".
   */
  podeGastarAcoes(n, { tipo = "acao", aviso = true } = {}) {
    const eco = economiaDoAtor(this);
    if (!eco.rastreia) return true;
    const pontos = pontosDoCusto(n, tipo, eco.modo);
    if (pontos <= eco.disponivel) return true;
    if (aviso) {
      const unidade = eco.modo === "reacoes" ? "reacao" : "acao";
      ui.notifications.warn(game.i18n.format("PYRO.Economia.Falta", {
        custo: textoDoPagamento(n, tipo, eco.modo),
        resta: textoDeAcoes(eco.disponivel, unidade)
      }));
    }
    return false;
  }

  /**
   * Tira um custo do contador do turno. No turno dos outros uma ação sai
   * como duas reações, e no próprio turno uma reação sai como uma ação.
   *
   * Numa fila própria do contador, e não na do ator: quem cobra (a entrada
   * numa forma, por exemplo) muitas vezes já roda na fila do ator, e ali
   * esperaria a si mesmo. A fila própria ainda impede que dois cliques
   * seguidos leiam o mesmo saldo e descontem uma vez só.
   * @returns {Promise<{ok: boolean, texto: string}>} o texto é o que o card
   *   mostra como custo: o que saiu do contador em combate, o custo escrito
   *   fora dele.
   */
  async gastarAcoes(n, { tipo = "acao", aviso = true } = {}) {
    const q = Math.max(0, Math.round(Number(n) || 0));
    if (!q) return { ok: true, texto: "" };
    return naFila({ uuid: `${this.uuid}#economia` }, async () => {
      const eco = economiaDoAtor(this);
      if (!eco.rastreia) return { ok: true, texto: textoDeAcoes(q, tipo) };
      if (!this.podeGastarAcoes(q, { tipo, aviso })) return { ok: false, texto: "" };
      const { doTurno, doExtra } = dividirGasto(eco, pontosDoCusto(q, tipo, eco.modo));
      await this.update({
        "system.economia.gastas": eco.gastas + doTurno,
        "system.economia.marca": eco.marca,
        ...(doExtra ? { "system.economia.extra": Math.max(0, eco.extra - doExtra) } : {})
      });
      return { ok: true, texto: textoDoPagamento(q, tipo, eco.modo) };
    });
  }

  /**
   * Atrasar ação (SRD §5): 2 ações agora por 1 reação a mais até o próximo
   * turno. Só no próprio turno, porque é dele que as ações saem.
   */
  async atrasarAcao() {
    if (!this.podeAgir()) return;
    const eco = economiaDoAtor(this);
    if (eco.rastreia && eco.modo !== "acoes") {
      return ui.notifications.warn(game.i18n.localize("PYRO.Economia.SoNoTurno"));
    }
    const gasto = await this.gastarAcoes(PYRO.acoesDoGuia.atrasar.acoes);
    if (!gasto.ok) return;
    if (eco.rastreia) {
      const de = `${eco.combate.id}:${eco.combate.round}`;
      const antes = this.system.economia?.extraDe === de ? Number(this.system.economia.extra) || 0 : 0;
      await this.update({ "system.economia.extra": antes + 1, "system.economia.extraDe": de });
    }
    return anunciarAcao(this, game.i18n.localize("PYRO.Guia.atrasar.Feito"), gasto.texto);
  }

  /**
   * Acerto manual do contador pela ficha: devolve (+1) ou tira (-1) um
   * ponto, para corrigir o que a mesa resolveu fora do sistema.
   */
  async ajustarEconomia(delta) {
    const eco = economiaDoAtor(this);
    if (!eco.rastreia) return;
    // Só o saldo do turno: as reações do Atrasar ação não se devolvem à mão.
    const gastas = Math.clamp(eco.gastas - Math.sign(Number(delta) || 0), 0, eco.max);
    await this.update({ "system.economia.gastas": gastas, "system.economia.marca": eco.marca });
  }

  /** Mover-se: até a velocidade em metros, por 1 ação (SRD §5). */
  async mover() {
    if (!this.podeAgir()) return;
    const gasto = await this.gastarAcoes(1);
    if (!gasto.ok) return;
    return anunciarAcao(this, game.i18n.format("PYRO.Economia.Moveu", {
      metros: this.system.velocidade ?? 0
    }), gasto.texto);
  }

  /* ---------------------------------------------------------------------- */
  /*  Posturas (SRD Técnicas)                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Postura ativa, ou null. A escolha é uma flag do ator e não um campo da
   * habilidade: só uma vale por vez, e guardá-la no ator torna impossível
   * ficar com duas ligadas.
   */
  get posturaAtiva() {
    const id = this.getFlag(SYSTEM_ID, "postura");
    const item = id ? this.items.get(id) : null;
    return item?.system?.ehPostura ? item : null;
  }

  /**
   * Entra numa postura, ou sai dela ao repetir a que já está ativa. Custa 1
   * ação em combate (SRD Técnicas), tirada do contador do turno.
   * @param {boolean} [opcoes.gratis] entrada pelo lembrete do começo da luta,
   *   que não cobra: o preço de esquecer é a ação, não o de lembrar.
   */
  async alternarPostura(item, { gratis = false } = {}) {
    if (item && !item.system?.ehPostura) return;
    const saindo = !item || this.posturaAtiva?.id === item.id;
    // Entrar ou trocar custa 1 ação; sair também é a guarda caindo, e aí não
    // há o que segurar — quem está esmagado pelo peso larga a postura.
    if (!saindo && !this.podeAgir()) return;
    const gasto = saindo || gratis ? { ok: true, texto: "" } : await this.gastarAcoes(1);
    if (!gasto.ok) return;
    await this.setFlag(SYSTEM_ID, "postura", saindo ? "" : item.id);
    // Entrar é o mesmo card de qualquer habilidade: o que a postura rende e a
    // descrição dela, que é o que a mesa precisa reler enquanto ela durar.
    // Sair não tem o que mostrar além do aviso.
    /*
     * Postura de NPC não vai para o chat aberto: o card traz a fórmula e a
     * descrição inteira, e o mestre trocando de guarda no meio da luta não
     * precisa entregar o que o inimigo faz. Personagem de jogador continua
     * anunciando na mesa, que é onde a postura importa.
     */
    const sussurro = temDonoJogador(this) ? [] : donosDe(this);
    if (!saindo) {
      const meta = [game.i18n.localize("PYRO.Postura.EntrouMeta"), gasto.texto]
        .filter(Boolean).join(" · ");
      return item.cardDeHabilidade(meta, sussurro);
    }
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      whisper: sussurro,
      content: `<p class="pyro-postura">${game.i18n.localize("PYRO.Postura.Saiu")}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Transformações                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * As formas em que o personagem está, na ordem em que entrou nelas. Várias
   * valem juntas: os efeitos de todas entram na conta, cada linha na ordem e
   * na prioridade dela, como qualquer outro efeito do ator. A ordem de
   * entrada só decide a aparência (ver aparenciaDasFormas).
   */
  get transformacoesAtivas() {
    return formasAtivas(this)
      .map(id => this.items.get(id))
      .filter(item => item?.system?.ehTransformacao);
  }

  /** O personagem está nesta forma? */
  emTransformacao(itemId) {
    return formasAtivas(this).includes(itemId);
  }

  /**
   * Entra numa transformação, ou sai dela ao repetir a que já está ativa.
   * Entrar numa forma não desliga as outras.
   *
   * Diferente da postura, entrar é um uso: os custos da habilidade são
   * cobrados antes, e uma forma que o personagem não pode pagar não começa.
   * O prazo vive num efeito marcador no ator (ver marcadorDeForma) porque é o
   * relógio de tempo.mjs que sabe descontar turno, e é a morte dele que acaba
   * a forma, inclusive quando o mestre o apaga à mão.
   */
  async alternarTransformacao(item) {
    return naFila(this, () => this.#entrarOuSairDaForma(item));
  }

  async #entrarOuSairDaForma(item) {
    if (!item?.system?.ehTransformacao) return;
    if (this.emTransformacao(item.id)) return this.#acabarForma(item.id, {});
    // O botão da ficha entra direto na forma, sem passar por usar(): sem esta
    // linha uma habilidade comprada e ainda não recebida seria cobrada aqui.
    if (item.system.adormecidaAtiva) {
      return ui.notifications.warn(
        game.i18n.format("PYRO.Despertar.AdormecidaAviso", { nome: item.name }));
    }

    const custos = await item.cobrarUso();
    if (custos === null) return; // faltou recurso: a forma não começa

    /*
     * Um marcador perdido desta forma (a lista foi limpa à mão) sai antes de
     * ela entrar na lista: apagado depois, o ouvinte de expiração entenderia
     * que a forma que acabou de começar terminou.
     */
    await this.#apagarMarcador(item.id);
    await this.setFlag(SYSTEM_ID, "transformacoes", [...formasAtivas(this), item.id]);

    const prazo = duracaoDaForma(item);
    await ActiveEffect.implementation.create(foundry.utils.mergeObject(
      dadosDePrazo(prazo?.valor ?? 0, prazo?.unidade ?? UNIDADE_PADRAO, {
        // Turnos passados desde a última cobrança da manutenção.
        transformacao: item.id, rotulo: item.name, manutencao: 0
      }),
      { name: item.name, img: item.img, origin: item.uuid }
    ), { parent: this });
    await this.#vestirAparencia();

    const meta = [
      game.i18n.localize("PYRO.Transformacao.EntrouMeta"),
      prazo ? textoDePrazo(prazo) : null,
      custos || null,
      textoDaManutencao(item) || null
    ].filter(Boolean).join(" · ");
    // NPC transformado não entrega a descrição inteira da forma à mesa, pelo
    // mesmo motivo da postura: o card traz tudo o que ela faz.
    const sussurro = temDonoJogador(this) ? [] : donosDe(this);
    return item.cardDeHabilidade(meta, sussurro);
  }

  /**
   * Acaba uma forma: tira da lista, apaga o marcador de prazo, devolve a
   * aparência e avisa a mesa. As outras formas continuam. Forma que já não
   * está ligada não faz nada, porque a saída é chamada também pela morte do
   * marcador, que pode chegar depois de alguém já ter saído pela ficha.
   *
   * @param {string} itemId a habilidade da forma.
   * @param {boolean} [opcoes.aviso] false quando quem chamou já contou o que
   *   aconteceu. O card do turno anuncia o prazo vencido e a manutenção que
   *   faltou com todo o resto, e um segundo aviso só repetiria a mesma linha
   *   noutra caixa.
   */
  async sairDaTransformacao(itemId, opcoes = {}) {
    return naFila(this, () => this.#acabarForma(itemId, opcoes));
  }

  async #acabarForma(itemId, { aviso = true }) {
    if (!this.emTransformacao(itemId)) return;
    const item = this.items.get(itemId) ?? null;
    /*
     * A lista muda antes do marcador: apagar o marcador com a forma ainda
     * listada faria o ouvinte de expiração acabar a mesma forma de novo.
     */
    await this.setFlag(SYSTEM_ID, "transformacoes",
      formasAtivas(this).filter(id => id !== itemId));
    await this.#apagarMarcador(itemId);
    await this.#vestirAparencia();

    // O preço da volta é cobrado depois que a forma cai, e não antes: os
    // efeitos dela não devem valer sobre a própria conta do que ela custou.
    const notas = await this.#cobrarFimDaForma(item);
    notas.push(...await this.#aplicarEfeitosDoFim(item));

    /*
     * Mesmo com o relógio anunciando o vencimento, o aviso sai quando a forma
     * cobrou algo: o card do turno diz que o prazo acabou, não que o
     * personagem ficou sem mana e com dois de exaustão.
     */
    if (!aviso && !notas.length) return;
    const linhas = [
      game.i18n.format("PYRO.Transformacao.Saiu", {
        nome: esc(item?.name ?? game.i18n.localize("PYRO.Transformacao.Nome"))
      }),
      ...notas
    ];
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      whisper: temDonoJogador(this) ? [] : donosDe(this),
      content: `<div class="pyro-chat">${linhas.map(l => `<p>${l}</p>`).join("")}</div>`
    });
  }

  /**
   * Cobra a manutenção das formas ligadas pelo tempo que passou. Uma forma
   * de "1 de estamina por minuto" paga 1 depois do primeiro minuto inteiro,
   * mais 1 depois do segundo, e assim por diante. A entrada já pagou o custo
   * da habilidade, então o relógio da manutenção começa em zero.
   *
   * Quem não consegue pagar paga as cobranças que couberem e sai da forma.
   * A estamina que faltar sai dos PV, como em qualquer custo, então ela
   * nunca derruba a forma sozinha.
   *
   * A saída fica com quem chamou, e não acontece aqui: o relógio desconta os
   * prazos antes de acabar a forma, como faz com a que vence sozinha, e os
   * efeitos de "ao acabar" começam a contar do zero.
   * @param {number} turnos quantos turnos passaram.
   * @returns {Promise<{relatos: string[], caidas: string[]}>} linhas para o
   *   card do relógio e as formas que não se pagaram.
   */
  async manterTransformacoes(turnos = 1) {
    const relatos = [];
    const caidas = [];
    for (const item of this.transformacoesAtivas) {
      const intervalo = intervaloDaManutencao(item);
      const cobra = custoDaManutencao(item);
      if (!intervalo || !Object.keys(cobra).length) continue;
      const marcador = marcadorDeForma(this, item.id);
      if (!marcador) continue;
      const flags = flagsDe(marcador) ?? {};
      const { vezes, resto } = cobrancasDaManutencao({
        acumulado: flags.manutencao, turnos, intervalo,
        restam: flags.turnos ?? flags.rodadas ?? null
      });
      if (resto !== (Number(flags.manutencao) || 0)) {
        await marcador.update({ [`flags.${SYSTEM_ID}.manutencao`]: resto });
      }
      if (!vezes) continue;

      const forma = esc(item.name);
      const nome = esc(this.name);
      const pagaveis = cobrancasPagaveis(cobra, this.system.recursos, vezes);
      if (pagaveis > 0) {
        const total = Object.fromEntries(
          Object.entries(cobra).map(([chave, valor]) => [chave, valor * pagaveis]));
        const pago = await this.pagarCustos(total);
        if (pago) {
          relatos.push(game.i18n.format("PYRO.Tempo.Manteve", {
            nome, forma, custos: textosDoPagamento(pago).join(" ")
          }));
        }
      }
      if (pagaveis < vezes) {
        relatos.push(game.i18n.format("PYRO.Tempo.FormaCaiu", { nome, forma }));
        caidas.push(item.id);
      }
    }
    return { relatos, caidas };
  }

  /**
   * Veste a aparência das formas ligadas, ou devolve a original quando
   * nenhuma delas troca a imagem.
   *
   * A original é guardada no ator na primeira troca, e não lida da ficha na
   * saída: com duas formas ligadas, a imagem da ficha já é a de uma delas.
   * Token não vinculado mexe só no próprio token. O vinculado mexe no token
   * padrão e em todos os tokens dele nas cenas, cada um voltando para a
   * imagem que tinha.
   */
  async #vestirAparencia() {
    const { retrato, token } = aparenciaDasFormas(this.transformacoesAtivas);
    let original = flagsDe(this)?.aparenciaOriginal ?? null;
    if (!retrato && !token && !original) return;

    const tokens = this.#tokensDoAtor();
    if (!original) {
      original = {
        retrato: this.img,
        prototipo: this.isToken ? null : (this.prototypeToken?.texture?.src ?? null),
        tokens: tokens.map(t => ({ uuid: t.uuid, src: t.texture?.src ?? "" }))
      };
      await this.setFlag(SYSTEM_ID, "aparenciaOriginal", original);
    }

    const update = {};
    const img = retrato ?? original.retrato;
    if (img && this.img !== img) update.img = img;
    if (!this.isToken && original.prototipo) {
      const src = token ?? original.prototipo;
      if (this.prototypeToken?.texture?.src !== src) update["prototypeToken.texture.src"] = src;
    }
    if (Object.keys(update).length) await this.update(update);

    for (const t of tokens) {
      // Token posto na cena depois da troca não tem original guardado: ele
      // nasceu do token padrão, e é para o padrão que ele volta.
      // Com imagem aleatória ("goblin*.webp") o padrão não é um arquivo, e o
      // token fica como está em vez de ganhar um caminho que não carrega.
      const src = token
        ?? original.tokens?.find(o => o.uuid === t.uuid)?.src
        ?? (original.prototipo?.includes("*") ? null : original.prototipo);
      if (src && t.texture?.src !== src) await t.update({ "texture.src": src });
    }

    if (!retrato && !token) await this.unsetFlag(SYSTEM_ID, "aparenciaOriginal");
  }

  /** Os tokens que mostram este ator, em todas as cenas. */
  #tokensDoAtor() {
    if (this.isToken) return this.token ? [this.token] : [];
    return (game.scenes?.contents ?? []).flatMap(cena =>
      cena.tokens.filter(t => t.actorLink && t.actorId === this.id));
  }

  /**
   * Cobra o que a forma leva embora ao cair (SRD não tem isto: é da mesa).
   * Cada linha é um recurso, tirando um tanto ou tudo o que houver. O que o
   * personagem não tem não vira dívida nem cai em PV — a forma já acabou, e
   * cobrar o que não existe mataria por engano.
   */
  async #cobrarFimDaForma(item) {
    const linhas = (item?.system?.fimDaForma ?? []).map(linha => [linha.recurso, linha]);
    if (!linhas.length) return [];
    const recursos = this.system.recursos ?? {};
    const dados = item.getRollData();
    const update = {};
    const notas = [];
    for (const [chave, linha] of linhas) {
      /*
       * Só os recursos que a ficha oferece. PV fica de fora: tirar vida por
       * aqui passaria por cima do caminho do dano e do desmaio que ele
       * dispara. A Força de Vontade entra, e é o preço mais caro que uma
       * forma pode cobrar — ela não volta com descanso nenhum (SRD
       * Atributos), então cobrá-la aqui é tirar do personagem algo que só o
       * jogo devolve.
       */
      if (!PYRO.recursosDeGasto().includes(chave)) continue;
      const atual = Number(recursos[chave]?.value);
      const tirado = gastoDoFim(linha, atual, dados);
      if (tirado <= 0) continue;
      update[`system.recursos.${chave}.value`] = atual - tirado;
      notas.push(game.i18n.format("PYRO.Transformacao.Fim.Gastou", {
        valor: tirado,
        recurso: game.i18n.localize(
          PYRO.recursosCustom?.[chave]?.label ?? `PYRO.Recursos.${chave}`)
      }));
    }
    if (Object.keys(update).length) await this.update(update);
    return notas;
  }

  /**
   * Aplica os efeitos marcados como "ao acabar" na habilidade: é por eles que
   * a forma deixa exaustão, queimando ou qualquer outra condição de ressaca.
   * Vão como cópia, pelo mesmo caminho do efeito de uso, para o prazo começar
   * a contar agora e o @nvl congelar no nível de hoje.
   */
  async #aplicarEfeitosDoFim(item) {
    const notas = [];
    for (const efeito of item?.effects ?? []) {
      if (!flagsDe(efeito)?.aoAcabar || efeito.disabled) continue;
      await ActiveEffect.implementation.create(
        dadosDoEfeitoAplicado(efeito, {}), { parent: this });
      notas.push(game.i18n.format("PYRO.Transformacao.Fim.Efeito", { nome: esc(efeito.name) }));
    }
    return notas;
  }

  /** Apaga o marcador de prazo de uma forma, se houver. */
  async #apagarMarcador(itemId) {
    const ids = (this.effects ?? [])
      .filter(e => flagsDe(e)?.transformacao === itemId)
      .map(e => e.id);
    if (ids.length) await this.deleteEmbeddedDocuments("ActiveEffect", ids);
  }

  /** Tomar Ar: recupera VIG/2 de estamina, até o máximo. Custa uma ação. */
  async tomarAr() {
    if (!this.podeAgir()) return;
    const gasto = await this.gastarAcoes(1);
    if (!gasto.ok) return;
    const estamina = this.system.recursos.estamina;
    // A culpa não deixa respirar direito: metade do fôlego de volta.
    const pelaMetade = regraMental(this, "tomarArMetade");
    const cheio = Math.floor(this.system.atributos.vig.total / 2);
    const rec = pelaMetade ? Math.floor(cheio / 2) : cheio;
    await this.update({
      "system.recursos.estamina.value": Math.min(estamina.max, estamina.value + rec)
    });
    const texto = game.i18n.format("PYRO.Chat.TomarAr", { valor: rec, custo: gasto.texto })
      + (pelaMetade ? ` ${game.i18n.localize("PYRO.Mental.TomarArMetade")}` : "");
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${texto}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Aplicação de dano e cura (menu do chat)                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Aplica dano descontando a defesa de cada tipo separadamente:
   *   (dano1 - defesa1) + (dano2 - defesa2) ...
   * Cada parcela tem piso 0, então uma defesa alta nunca vira cura.
   * Dano de categoria mental consome Mana em vez de PV (SRD §6).
   *
   * @param {Array<{tipo: string, total: number}>} entradas
   * @param {object} [opcoes]
   * @param {number} [opcoes.multiplicador]  metade (0.5), dobro (2)...
   * @param {boolean} [opcoes.ignorarDefesa] força o valor cheio
   * @param {boolean} [opcoes.mental]        trata tudo como mental
   * @returns {Promise<string>} resumo com a conta feita
   */
  async aplicarDano(entradas, {
    multiplicador = 1, ignorarDefesa = false, mental = false, recursoMental = "mana"
  } = {}) {
    const recursos = this.system.recursos;
    const totais = this.system.defesas.totais;
    /*
     * O recurso vem declarado no golpe, e é nele que o dano mental entra. Um
     * recurso próprio de caminho (Energia Natural e afins) existe no schema de
     * todo ator, mas só vale para quem o caminho concedeu — por isso a
     * pergunta é essa, e não a existência do campo.
     *
     * Quem não tem o recurso não sofre o dano: um golpe que queima mana não
     * tem o que queimar num alvo sem magia. O card diz isso em vez de cobrar
     * de outra barra.
     */
    const proprio = PYRO.recursosCustom?.[recursoMental];
    const temRecurso = !!recursos[recursoMental]
      && (!proprio || (this.system.recursosConcedidos ?? []).includes(recursoMental));
    let emPv = 0;
    let emRecurso = 0;
    const contas = [];

    /*
     * Molhado espera o frio: a primeira instância de dano de frio que chegar
     * leva as pilhas como dados a mais, do mesmo dado do golpe, e consome a
     * condição inteira. Rolado aqui, e não na origem, porque quem molhou o
     * alvo raramente é quem congela.
     */
    // Dano mental não tem tipo elemental: ele drena recurso, não congela.
    const frias = mental ? [] : entradas.filter(e => e.tipo === "frio");
    // Todas as fórmulas de frio juntas: o Molhado acompanha o maior dado do
    // golpe, e não o da primeira parcela que apareceu na lista.
    const molhado = frias.length
      ? dadosDeMolhado(this, frias.map(e => e.formula ?? "").join(" "))
      : null;
    let extraMolhado = 0;
    if (molhado) {
      const roll = await new Roll(`${molhado.pilhas}d${molhado.faces}`).evaluate();
      extraMolhado = roll.total;
      await reduzirCondicao(this, "molhado");
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: game.i18n.format("PYRO.Condicoes.MolhadoConsumido", {
          nome: esc(this.name), pilhas: molhado.pilhas, faces: molhado.faces
        })
      });
    }

    for (const entrada of entradas) {
      const tipo = mental ? "mental" : entrada.tipo;
      // O extra do Molhado entra antes da defesa: é dano da mesma instância.
      const comMolhado = entrada.total + (tipo === "frio" ? extraMolhado : 0);
      const bruto = Math.floor(comMolhado * multiplicador);
      if (tipo === "frio") extraMolhado = 0;
      // Sem tipo conhecido (rolagem avulsa no chat) não há defesa a aplicar.
      const defesa = ignorarDefesa || !tipo ? 0 : (totais[tipo] ?? 0);
      const liquido = Math.max(0, bruto - defesa);

      if (PYRO.tiposDano[tipo]?.categoria === "mental") emRecurso += liquido;
      else emPv += liquido;

      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      contas.push(defesa
        ? `${rotulo} ${bruto}-${defesa}=${liquido}`
        : `${rotulo} ${liquido}`.trim());
    }

    const pvNovo = Math.max(0, recursos.pv.value - emPv);
    const update = { "system.recursos.pv.value": pvNovo };
    if (emRecurso && temRecurso) {
      update[`system.recursos.${recursoMental}.value`] =
        Math.max(0, recursos[recursoMental].value - emRecurso);
    }
    await this.update(update);

    const nomeRecurso = () =>
      game.i18n.localize(PYRO.recursosDrenaveis()[recursoMental] ?? recursoMental);
    const partes = [];
    if (emPv) partes.push(game.i18n.format("PYRO.Chat.AplicouDano", { valor: emPv, pv: pvNovo }));
    if (emRecurso && temRecurso) {
      partes.push(game.i18n.format("PYRO.Chat.AplicouMental", {
        valor: emRecurso, recurso: nomeRecurso()
      }));
    }
    if (emRecurso && !temRecurso) {
      partes.push(game.i18n.format("PYRO.Chat.MentalSemRecurso", { recurso: nomeRecurso() }));
    }
    if (!partes.length) partes.push(game.i18n.localize("PYRO.Chat.DefesaAbsorveu"));

    return `${this.name}: ${partes.join(" · ")} (${contas.join(" + ")})`;
  }

  /** Cura PV até o máximo. */
  async aplicarCura(valor) {
    const pv = this.system.recursos.pv;
    const novo = Math.min(pv.max, pv.value + Math.max(0, Math.floor(valor)));
    await this.update({ "system.recursos.pv.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouCura", { valor: novo - pv.value, pv: novo })}`;
  }

  /** Devolve estamina (efeitos de fôlego, itens). */
  async aplicarEstamina(valor) {
    const estamina = this.system.recursos.estamina;
    const novo = Math.clamp(estamina.value + Math.floor(valor), 0, estamina.max);
    await this.update({ "system.recursos.estamina.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouEstamina", { valor: novo - estamina.value })}`;
  }

  /* ---------------------------------------------------------------------- */
  /*  Recuperação por passagem de tempo                                     */
  /* ---------------------------------------------------------------------- */

  /** Recursos personalizados que este personagem tem acesso. */
  #recursosExtras() {
    return (this.system.recursosConcedidos ?? []).filter(c => this.system.recursos[c]);
  }

  /** Início de cena: estamina cheia, +VIG de PV, +recuperação de mana. */
  async recuperarCena() {
    const recursos = this.system.recursos;
    const vig = this.system.atributos.vig.total;
    /*
     * A densidade da região onde o token está multiplica a recuperação: em
     * mana abundante recupera-se em dobro, sem mana nenhuma não se recupera.
     * Os recursos de raça (a Energia Natural do elfo) respiram a mesma mana
     * do ar, então seguem o fator dela.
     */
    const fMana = multRecuperacaoDoAtor(this, "mana");
    const fEnergia = multRecuperacaoDoAtor(this, "energia");
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      const rec = recursos[chave];
      extras[`system.recursos.${chave}.value`] =
        Math.min(rec.max, rec.value + comDensidade(rec.recuperacao ?? 0, fMana));
    }
    await this.update({
      ...extras,
      "system.recursos.estamina.value": recursos.estamina.max,
      "system.recursos.pv.value": Math.min(recursos.pv.max, recursos.pv.value + vig),
      "system.recursos.mana.value": Math.min(recursos.mana.max,
        recursos.mana.value + comDensidade(recursos.mana.recuperacao, fMana)),
      "system.recursos.energia.value": Math.min(recursos.energia.max,
        recursos.energia.value + comDensidade(recursos.energia.recuperacao, fEnergia))
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovaCena")}</p>`
    });
  }

  /**
   * Início de capítulo: vida e mana completas. É a maior recuperação da mesa —
   * a passagem de tempo do sistema vai até aqui.
   *
   * A Força de Vontade fica de fora de propósito. Ela não volta com o tempo
   * (SRD Atributos): todo ponto é conquistado em jogo — por um instinto que
   * criou problema, por uma crença defendida —, e enchê-la aqui tornaria o
   * resto dessa economia decorativa.
   */
  async recuperarCapitulo() {
    const recursos = this.system.recursos;
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      extras[`system.recursos.${chave}.value`] = recursos[chave].max;
    }
    await this.update({
      ...extras,
      "system.recursos.pv.value": recursos.pv.max,
      "system.recursos.mana.value": recursos.mana.max,
      "system.recursos.energia.value": recursos.energia.max,
      "system.recursos.estamina.value": recursos.estamina.max
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoCapitulo")}</p>`
    });
  }

}

/* -------------------------------------------------------------------------- */
/*  Transformações: seleção e prazo                                           */
/* -------------------------------------------------------------------------- */

/** Habilidades marcadas como transformação, na ordem da ficha. */
export function transformacoesDoAtor(actor) {
  return actor?.items
    .filter(i => i.type === "habilidade" && i.system.ehTransformacao)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) ?? [];
}

/** O efeito que conta o prazo de uma forma, se ela estiver ligada. */
export function marcadorDeForma(actor, itemId) {
  return (actor?.effects ?? []).find(e => flagsDe(e)?.transformacao === itemId) ?? null;
}

/**
 * Quanto a forma dura, com a fórmula já resolvida no nível atual da
 * habilidade. Null quando a forma não tem prazo — ela fica até o jogador sair.
 */
export function duracaoDaForma(item) {
  const escrito = String(item?.system?.duracao?.valor ?? "").trim();
  if (!escrito) return null;
  const bruto = Math.floor(calcularFormula(escrito, item.getRollData()));
  if (!(bruto > 0)) return null;
  const unidade = item.system.duracao.unidade || UNIDADE_PADRAO;
  /*
   * Em segundos o prazo é arredondado para os turnos que o relógio vai contar
   * (10s cabem em 2 turnos, ou seja 12s), que é o número guardado no
   * marcador. Anunciar o escrito faria o card dizer 10 e a ficha mostrar 12
   * no instante seguinte.
   */
  const valor = contaEmTurnos(unidade) ? daUnidade(turnosDe(bruto, unidade), unidade) : bruto;
  return { valor, unidade };
}

/**
 * O que pagarCustos devolveu, em frases de card: a estamina, os PV que
 * cobriram a estamina que faltou e cada recurso gasto.
 */
export function textosDoPagamento(pago) {
  const frases = [];
  for (const [chave, valor] of Object.entries(pago ?? {})) {
    if (!(valor > 0)) continue;
    if (chave === "daEstamina") frases.push(game.i18n.format("PYRO.Chat.CustoEstamina", { valor }));
    else if (chave === "dosPv") frases.push(game.i18n.format("PYRO.Chat.CustoPv", { valor }));
    else frases.push(game.i18n.format("PYRO.Chat.CustoRecurso", { valor, recurso: nomeDoRecurso(chave) }));
  }
  return frases;
}

/** "12 turnos", na unidade em que o prazo foi escrito. */
export function textoDePrazo({ valor, unidade }) {
  return `${valor} ${game.i18n.localize(
    PYRO.unidadesDeDuracao[unidade]?.curto ?? unidade)}`;
}

/**
 * Quanto sai de um recurso quando a forma acaba: o que a linha pede, limitado
 * ao que o personagem tem. "Zerar" leva tudo o que sobrou; "gastar" resolve a
 * fórmula escrita (aceita @nvl, como a duração) e arredonda.
 *
 * O limite é do lado do personagem de propósito: a forma já caiu, e cobrar
 * mais do que existe viraria dívida ou dano que ninguém pediu.
 */
export function gastoDoFim(linha, atual, dados = null) {
  const valor = Number(atual);
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  if (linha?.modo === "zerar") return valor;
  const pedido = Math.max(0, Math.round(calcularFormula(String(linha?.valor ?? ""), dados)));
  return Math.min(valor, pedido);
}
