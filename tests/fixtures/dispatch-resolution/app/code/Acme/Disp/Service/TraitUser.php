<?php
namespace Acme\Disp\Service;

class TraitUser
{
    use DispatchTrait;

    const EVENT = 'acme_trait_user';

    public $eventManager;
}
