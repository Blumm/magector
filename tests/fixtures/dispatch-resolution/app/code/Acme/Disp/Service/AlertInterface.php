<?php
namespace Acme\Disp\Service;

interface AlertInterface extends BaseAlertInterface
{
    public const EVENT_PREFIX = 'acme_alert';
}
