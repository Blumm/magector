<?php
declare(strict_types=1);

namespace Acme\Ext\Model;

USE Acme\Core\Api\NotifierInterface;

/** Keywords are case-insensitive in PHP. */
Class UpperNotifier Implements NotifierInterface
{
    Public Function notify(): void
    {
    }
}
